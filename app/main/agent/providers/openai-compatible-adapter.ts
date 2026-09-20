import OpenAI from 'openai';
import type { AgentModelInfo, AgentModelVendor, AgentProviderId } from '@lumacast/protocol';
import { cleanCatalogModelName, inferModelVendor, prettifyModelId } from '@lumacast/protocol';
import { withIdleTimeout } from './request-timeout';
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
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;

const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/IT-PSAPE/LumaCast',
  'X-OpenRouter-Title': 'LumaCast',
  'X-Title': 'LumaCast',
};

/** The `AgentProviderId`s this adapter covers directly with the Chat Completions wire format. */
export type OpenAiCompatibleProviderId = 'openai' | 'google' | 'openrouter' | 'openai-compatible';

/**
 * Adapter-tuning knobs, injectable from tests; defaults are production-ready.
 */
interface OpenAiCompatibleDependencies {
  /** Dead air (no streamed progress) tolerated before a chat request is aborted as a stalled network. */
  streamIdleTimeoutMs: number;
}

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
    // `function_call` (deprecated) and non-standard values some
    // OpenAI-compatible providers emit (Gemini's `MALFORMED_FUNCTION_CALL`,
    // etc.) fold to 'other' — this must never throw on an unrecognized
    // value. `null` (stream ended without a finish_reason) and `'error'`
    // never reach this mapper: `chat` turns them into stream errors first.
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
  if (error instanceof ProviderError) return { code: error.code, message };
  if (error instanceof OpenAI.AuthenticationError) return { code: 'auth', message };
  if (error instanceof OpenAI.RateLimitError) return { code: 'rate_limit', message };
  if (error instanceof OpenAI.NotFoundError) return { code: 'invalid_model', message };
  if (error instanceof OpenAI.APIConnectionError) return { code: 'network', message };
  // Mid-stream errors from OpenAI-compatible providers (notably OpenRouter
  // free-tier rate limits, which arrive after the 200 is already committed)
  // are thrown as a bare `APIError` carrying the numeric code on `error.code`
  // but no typed subclass — treat those 429s like any other rate limit so the
  // caller still sees a retryable `rate_limit` instead of an opaque provider
  // failure.
  if (error instanceof OpenAI.APIError && (error.status === 429 || String(error.code) === '429')) {
    return { code: 'rate_limit', message };
  }
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
  private readonly streamIdleTimeoutMs: number;

  constructor(provider: OpenAiCompatibleProviderId, options: ProviderAdapterOptions, deps?: Partial<OpenAiCompatibleDependencies>) {
    this.id = provider;
    this.streamIdleTimeoutMs = deps?.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;

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
        // OpenRouter's `/models` response carries `context_length`,
        // `supported_parameters`, a display `name` ("Anthropic: Claude
        // Sonnet 4"), and `pricing` (decimal-string prompt/completion cost,
        // "0" for free) alongside the standard OpenAI `Model` shape; the
        // SDK's `Model` type doesn't declare any of these, but the SDK
        // doesn't strip unknown JSON fields either, so they still land on
        // the parsed object. Reading them via a cast over the already-
        // parsed model reuses the SDK's own pagination/auth instead of a
        // second raw `fetch` to the same endpoint.
        const raw = model as OpenAI.Models.Model & {
          context_length?: number | null;
          supported_parameters?: string[];
          name?: string | null;
          pricing?: { prompt?: string; completion?: string };
        };

        const isOpenRouter = this.id === 'openrouter';
        const promptPrice = Number(raw.pricing?.prompt);
        const completionPrice = Number(raw.pricing?.completion);
        const isFree = isOpenRouter && (model.id.endsWith(':free') || (promptPrice === 0 && completionPrice === 0));

        const label = isOpenRouter ? cleanCatalogModelName(raw.name, model.id) : prettifyModelId(model.id);
        let vendor: AgentModelVendor | null = isOpenRouter
          ? inferModelVendor(model.id, { name: raw.name ?? null })
          : inferModelVendor(model.id);
        if (!isOpenRouter && vendor === null) {
          if (this.id === 'openai') vendor = 'openai';
          if (this.id === 'google') vendor = 'google';
        }

        models.push({
          id: model.id,
          label,
          contextWindow: isOpenRouter ? (raw.context_length ?? null) : null,
          maxOutputTokens: null,
          supportsTools: isOpenRouter ? (raw.supported_parameters?.includes('tools') ?? true) : true,
          isFree,
          vendor,
        });
      }
      return models;
    } catch (error) {
      const { code, message } = classifyError(error, signal);
      throw new ProviderError(code, message);
    }
  }

  async validateModel(modelId: string, signal?: AbortSignal): Promise<'valid' | 'not-found' | 'unknown'> {
    if (this.id === 'openrouter') {
      try {
        const models = await this.listModels(signal);
        return models.some((model) => model.id === modelId) ? 'valid' : 'not-found';
      } catch {
        return 'unknown';
      }
    }
    try {
      await this.client.models.retrieve(modelId, { signal });
      return 'valid';
    } catch {
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
      ...(this.id === 'openrouter' && tools.length > 0 ? { provider: { require_parameters: true } } : {}),
    };

    const toolCallsByIndex = new Map<number, ToolCallAccumulator>();
    const textChunks: string[] = [];
    let finishReason: string | null = null;
    let usage: { inputTokens: number | null; outputTokens: number | null } | null = null;

    const idle = withIdleTimeout(request.signal, this.streamIdleTimeoutMs);
    try {
      idle.signal.throwIfAborted();
      const stream = await this.client.chat.completions.create(params, { signal: idle.signal });
      for await (const chunk of stream) {
        idle.signal.throwIfAborted();
        const envelope = chunk as typeof chunk & { error?: { code?: string | number; message?: string } };
        if (envelope.error) {
          throw new ProviderError(String(envelope.error.code) === '429' ? 'rate_limit' : 'provider', envelope.error.message ?? 'Provider failed during streaming');
        }
        const choice = chunk.choices?.[0];
        const progress = choice?.delta as (typeof choice.delta & { reasoning?: string; reasoning_content?: string; reasoning_details?: unknown[] }) | undefined;
        if (progress?.content || progress?.tool_calls?.length || progress?.reasoning || progress?.reasoning_content || progress?.reasoning_details?.length || choice?.finish_reason || chunk.usage) {
          idle.reset();
        }
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

      idle.signal.throwIfAborted();
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

      if (finishReason === 'error') {
        yield { type: 'error', code: 'provider', message: 'Provider failed during streaming' };
      } else if (finishReason === null && assistantParts.length === 0) {
        yield { type: 'error', code: 'provider', message: 'Stream ended with no output' };
      } else if (finishReason === null) {
        yield { type: 'error', code: 'provider', message: 'Stream ended without a finish reason' };
      } else {
        yield { type: 'done', stopReason: mapFinishReason(finishReason), assistant: assistantParts };
      }
    } catch (error) {
      if (idle.didTimeout()) {
        yield { type: 'error', code: 'network', message: `Stream stalled: no data received for ${this.streamIdleTimeoutMs}ms` };
      } else {
        const { code, message } = classifyError(error, request.signal);
        yield { type: 'error', code, message };
      }
    } finally {
      idle.dispose();
    }
  }
}
