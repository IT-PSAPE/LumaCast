import OpenAI from 'openai';
import type { AgentModelInfo, AgentProviderId } from '@lumacast/protocol';
import { ProviderError } from './types';
import type {
  AssistantPart,
  ProviderAdapter,
  ProviderAdapterOptions,
  ProviderChatRequest,
  ProviderErrorCode,
  ProviderMessage,
  ProviderStopReason,
  ProviderStreamEvent,
  ProviderToolDefinition,
} from './types';

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/IT-PSAPE/LumaCast',
  'X-OpenRouter-Title': 'LumaCast',
  'X-Title': 'LumaCast',
};

/** The `AgentProviderId`s this adapter covers directly with the Chat Completions wire format. */
export type OpenAiCompatibleProviderId = 'openai' | 'google' | 'openrouter' | 'openai-compatible';

// ---------------------------------------------------------------------------
// Pure mapping helpers.
// ---------------------------------------------------------------------------

function toOpenAiMessages(system: string, messages: ProviderMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];

  for (const message of messages) {
    if (message.role === 'user') {
      result.push({ role: 'user', content: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      const text = message.parts
        .filter((part): part is Extract<AssistantPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('');
      const toolCalls = message.parts.filter((part): part is Extract<AssistantPart, { type: 'tool_call' }> => part.type === 'tool_call');

      const assistantMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        // Required unless tool_calls is set — an empty string is not the
        // same as "no content" to every provider, so use null when there's
        // no text at all.
        content: text.length > 0 ? text : null,
      };
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: { name: toolCall.name, arguments: toolCall.rawArguments },
        }));
      }
      result.push(assistantMessage);
      continue;
    }

    // 'tool_results' — the OpenAI wire format has no room for multiple
    // results in one message, so this is the one place the provider-neutral
    // "all results together" shape fans out into one `tool` message per
    // result (never combined, unlike the Anthropic adapter).
    for (const toolResult of message.results) {
      result.push({ role: 'tool', tool_call_id: toolResult.toolCallId, content: toolResult.content });
    }
  }

  return result;
}

function toOpenAiTools(tools: ProviderToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      // `JsonSchema` (`{[key: string]: unknown}`) and the SDK's
      // `FunctionParameters` are the exact same shape — no cast needed.
      parameters: tool.inputSchema,
    },
  }));
}

function mapFinishReason(finishReason: string | null): ProviderStopReason {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    // null (stream ended without a finish_reason), 'function_call'
    // (deprecated), and non-standard values some OpenAI-compatible
    // providers emit (Gemini's `MALFORMED_FUNCTION_CALL`, etc.) all fold to
    // 'other' — this must never throw on an unrecognized value.
    default:
      return 'other';
  }
}

function parseToolArguments(rawArguments: string): { arguments: unknown; parseError: string | null } {
  const trimmed = rawArguments.trim();
  if (trimmed.length === 0) {
    return { arguments: {}, parseError: null };
  }
  try {
    return { arguments: JSON.parse(rawArguments) as unknown, parseError: null };
  } catch (error) {
    return { arguments: null, parseError: error instanceof Error ? error.message : String(error) };
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof OpenAI.APIUserAbortError || (error instanceof Error && error.name === 'AbortError');
}

function classifyError(error: unknown, signal?: AbortSignal): { code: ProviderErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if ((signal?.aborted ?? false) || isAbortError(error)) {
    return { code: 'aborted', message };
  }
  if (error instanceof OpenAI.AuthenticationError) return { code: 'auth', message };
  if (error instanceof OpenAI.RateLimitError) return { code: 'rate_limit', message };
  if (error instanceof OpenAI.NotFoundError) return { code: 'invalid_model', message };
  if (error instanceof OpenAI.APIConnectionError) return { code: 'network', message };
  if (error instanceof OpenAI.APIError) return { code: 'provider', message };
  return { code: 'provider', message };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

interface ToolCallAccumulator {
  id: string;
  name: string;
  json: string;
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly id: AgentProviderId;

  private readonly client: OpenAI;

  constructor(provider: OpenAiCompatibleProviderId, options: ProviderAdapterOptions) {
    this.id = provider;

    let baseURL: string | undefined;
    switch (provider) {
      case 'openai':
        baseURL = undefined; // SDK default (https://api.openai.com/v1)
        break;
      case 'google':
        baseURL = GOOGLE_BASE_URL;
        break;
      case 'openrouter':
        baseURL = OPENROUTER_BASE_URL;
        break;
      case 'openai-compatible':
        if (!options.baseUrl) {
          throw new ProviderError('provider', 'The openai-compatible provider requires a base URL');
        }
        baseURL = options.baseUrl;
        break;
    }

    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL,
      maxRetries: MAX_RETRIES,
      timeout: REQUEST_TIMEOUT_MS,
      ...(provider === 'openrouter' ? { defaultHeaders: OPENROUTER_HEADERS } : {}),
    });
  }

  async listModels(signal?: AbortSignal): Promise<AgentModelInfo[]> {
    try {
      const models: AgentModelInfo[] = [];
      for await (const model of this.client.models.list({ signal })) {
        // OpenRouter's `/models` response carries `context_length` and
        // `supported_parameters` alongside the standard OpenAI `Model`
        // shape; the SDK's `Model` type doesn't declare them, but the SDK
        // doesn't strip unknown JSON fields either, so they still land on
        // the parsed object. Reading them via a cast over the already-
        // parsed model reuses the SDK's own pagination/auth instead of a
        // second raw `fetch` to the same endpoint.
        const raw = model as OpenAI.Models.Model & { context_length?: number | null; supported_parameters?: string[] };
        models.push({
          id: model.id,
          label: model.id,
          contextWindow: this.id === 'openrouter' ? (raw.context_length ?? null) : null,
          maxOutputTokens: null,
          supportsTools: this.id === 'openrouter' ? (raw.supported_parameters?.includes('tools') ?? true) : true,
          isFree: false,
        });
      }
      return models;
    } catch (error) {
      const { code, message } = classifyError(error, signal);
      throw new ProviderError(code, message);
    }
  }

  async validateModel(modelId: string, signal?: AbortSignal): Promise<'valid' | 'not-found' | 'unknown'> {
    try {
      await this.client.models.retrieve(modelId, { signal });
      return 'valid';
    } catch (error) {
      if (error instanceof OpenAI.NotFoundError) {
        return 'not-found';
      }
      // Some OpenAI-compatible providers (e.g. Google's Gemini endpoint)
      // don't support GET /models/{id} at all — fall back to listing and
      // searching before giving up.
      try {
        const models = await this.listModels(signal);
        return models.some((model) => model.id === modelId) ? 'valid' : 'not-found';
      } catch {
        return 'unknown';
      }
    }
  }

  async *chat(request: ProviderChatRequest): AsyncIterable<ProviderStreamEvent> {
    const tools = toOpenAiTools(request.tools);
    const params: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: request.model,
      messages: toOpenAiMessages(request.system, request.messages),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: request.maxOutputTokens ?? undefined,
      ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
    };

    // Tool calls are keyed by their stream index (fragments for the same
    // call share an index; id/name typically arrive on the first fragment).
    const toolCallsByIndex = new Map<number, ToolCallAccumulator>();
    const textChunks: string[] = [];
    let finishReason: string | null = null;
    let usage: { inputTokens: number | null; outputTokens: number | null } | null = null;

    try {
      const stream = await this.client.chat.completions.create(params, { signal: request.signal });
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice) {
          const delta = choice.delta;
          if (delta?.content) {
            textChunks.push(delta.content);
            yield { type: 'text_delta', text: delta.content };
          }
          if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
              let accumulator = toolCallsByIndex.get(toolCallDelta.index);
              if (!accumulator) {
                accumulator = {
                  id: toolCallDelta.id ?? `call_${toolCallDelta.index}`,
                  name: toolCallDelta.function?.name ?? '',
                  json: '',
                };
                toolCallsByIndex.set(toolCallDelta.index, accumulator);
                yield { type: 'tool_call_start', id: accumulator.id, name: accumulator.name };
              } else {
                if (toolCallDelta.id) accumulator.id = toolCallDelta.id;
                if (toolCallDelta.function?.name) accumulator.name = toolCallDelta.function.name;
              }
              if (toolCallDelta.function?.arguments) {
                accumulator.json += toolCallDelta.function.arguments;
                yield { type: 'tool_call_delta', id: accumulator.id, argumentsDelta: toolCallDelta.function.arguments };
              }
            }
          }
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }
        if (chunk.usage) {
          usage = { inputTokens: chunk.usage.prompt_tokens ?? null, outputTokens: chunk.usage.completion_tokens ?? null };
        }
      }

      const assistantParts: AssistantPart[] = [];
      const text = textChunks.join('');
      if (text.length > 0) {
        assistantParts.push({ type: 'text', text });
      }

      for (const index of [...toolCallsByIndex.keys()].sort((a, b) => a - b)) {
        const accumulator = toolCallsByIndex.get(index);
        if (!accumulator) continue;
        const { arguments: parsedArguments, parseError } = parseToolArguments(accumulator.json);
        yield {
          type: 'tool_call_end',
          id: accumulator.id,
          name: accumulator.name,
          arguments: parsedArguments,
          rawArguments: accumulator.json,
          parseError,
        };
        assistantParts.push({
          type: 'tool_call',
          id: accumulator.id,
          name: accumulator.name,
          arguments: parsedArguments,
          rawArguments: accumulator.json,
          parseError,
        });
      }

      if (usage) {
        yield { type: 'usage', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
      }

      yield { type: 'done', stopReason: mapFinishReason(finishReason), assistant: assistantParts };
    } catch (error) {
      const { code, message } = classifyError(error, request.signal);
      yield { type: 'error', code, message };
    }
  }
}
