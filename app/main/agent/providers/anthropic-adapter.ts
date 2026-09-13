import Anthropic from '@anthropic-ai/sdk';
import type { AgentModelInfo } from '@lumacast/protocol';
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
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Pure mapping helpers (no SDK client needed — kept as module-level functions
// so they're trivially unit-testable and don't accidentally reach for `this`).
// ---------------------------------------------------------------------------

function toAnthropicMessages(messages: ProviderMessage[]): Anthropic.MessageParam[] {
  return messages.map((message): Anthropic.MessageParam => {
    if (message.role === 'user') {
      return { role: 'user', content: message.content };
    }
    if (message.role === 'assistant') {
      const content: Anthropic.ContentBlockParam[] = message.parts.map((part) => {
        if (part.type === 'text') {
          return { type: 'text', text: part.text };
        }
        return { type: 'tool_use', id: part.id, name: part.name, input: part.arguments };
      });
      return { role: 'assistant', content };
    }
    // 'tool_results' — always folded into ONE user message carrying every
    // result for the preceding assistant turn's tool calls, never split
    // across multiple messages (splitting would silently train the model
    // away from parallel tool use).
    const content: Anthropic.ToolResultBlockParam[] = message.results.map((result) => ({
      type: 'tool_result',
      tool_use_id: result.toolCallId,
      content: result.content,
      is_error: result.isError,
    }));
    return { role: 'user', content };
  });
}

function toAnthropicTool(tool: ProviderToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    // `ProviderToolDefinition.inputSchema` is the provider-neutral `JsonSchema`
    // (`{[key: string]: unknown}`); the Anthropic SDK's `Tool.InputSchema`
    // additionally requires a literal `type: 'object'`, which every tool
    // schema in this codebase already satisfies by construction.
    input_schema: tool.inputSchema as unknown as Anthropic.Tool['input_schema'],
  };
}

function mapStopReason(stopReason: Anthropic.StopReason | null): ProviderStopReason {
  switch (stopReason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    // 'pause_turn', 'stop_sequence', 'model_context_window_exceeded', and null
    // (should never reach here for a completed message) all fold to 'other'.
    default:
      return 'other';
  }
}

function parseToolArguments(rawArguments: string): { arguments: unknown; parseError: string | null } {
  const trimmed = rawArguments.trim();
  if (trimmed.length === 0) {
    // A tool with an empty input schema can stream no `input_json_delta` at
    // all; treat "nothing streamed" as an empty object rather than a parse
    // failure.
    return { arguments: {}, parseError: null };
  }
  try {
    return { arguments: JSON.parse(rawArguments) as unknown, parseError: null };
  } catch (error) {
    return { arguments: null, parseError: error instanceof Error ? error.message : String(error) };
  }
}

interface FinishedToolCall {
  name: string;
  rawArguments: string;
  arguments: unknown;
  parseError: string | null;
}

function buildAssistantParts(content: Anthropic.ContentBlock[], finishedToolCalls: Map<string, FinishedToolCall>): AssistantPart[] {
  const parts: AssistantPart[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text });
    } else if (block.type === 'tool_use') {
      const finished = finishedToolCalls.get(block.id);
      if (finished) {
        parts.push({
          type: 'tool_call',
          id: block.id,
          name: finished.name,
          arguments: finished.arguments,
          rawArguments: finished.rawArguments,
          parseError: finished.parseError,
        });
      } else {
        // Defensive fallback — every tool_use block should have gone through
        // a content_block_start/stop pair during streaming. If one somehow
        // didn't, fall back to the SDK's own already-parsed `input`.
        parts.push({
          type: 'tool_call',
          id: block.id,
          name: block.name,
          arguments: block.input,
          rawArguments: JSON.stringify(block.input ?? null),
          parseError: null,
        });
      }
    }
    // Other block types (thinking, redacted_thinking, server-tool blocks,
    // etc.) are intentionally not represented in the provider-neutral
    // `AssistantPart` union.
  }
  return parts;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Anthropic.APIUserAbortError || (error instanceof Error && error.name === 'AbortError');
}

function classifyError(error: unknown, signal?: AbortSignal): { code: ProviderErrorCode; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if ((signal?.aborted ?? false) || isAbortError(error)) {
    return { code: 'aborted', message };
  }
  if (error instanceof Anthropic.AuthenticationError) return { code: 'auth', message };
  if (error instanceof Anthropic.RateLimitError) return { code: 'rate_limit', message };
  if (error instanceof Anthropic.NotFoundError) return { code: 'invalid_model', message };
  if (error instanceof Anthropic.APIConnectionError) return { code: 'network', message };
  if (error instanceof Anthropic.APIError) return { code: 'provider', message };
  return { code: 'provider', message };
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic' as const;

  private readonly client: Anthropic;

  constructor(options: ProviderAdapterOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseUrl ?? undefined,
      maxRetries: MAX_RETRIES,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  async listModels(signal?: AbortSignal): Promise<AgentModelInfo[]> {
    try {
      const models: AgentModelInfo[] = [];
      for await (const model of this.client.models.list(undefined, { signal })) {
        models.push({
          id: model.id,
          label: model.display_name,
          contextWindow: model.max_input_tokens,
          maxOutputTokens: model.max_tokens,
          supportsTools: true,
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
      await this.client.models.retrieve(modelId, undefined, { signal });
      return 'valid';
    } catch (error) {
      if (error instanceof Anthropic.NotFoundError) return 'not-found';
      return 'unknown';
    }
  }

  async *chat(request: ProviderChatRequest): AsyncIterable<ProviderStreamEvent> {
    const tools = request.tools.map(toAnthropicTool);
    const params: Anthropic.MessageCreateParamsStreaming = {
      model: request.model,
      system: request.system,
      messages: toAnthropicMessages(request.messages),
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      cache_control: { type: 'ephemeral' },
      stream: true,
      // Only newest models reject forced tool use, so tool_choice is always
      // 'auto' — never 'any'/'tool'. `thinking` is omitted entirely so the
      // same request shape works whether or not the model thinks by default.
      ...(tools.length > 0 ? { tools, tool_choice: { type: 'auto' as const } } : {}),
    };

    const stream = this.client.messages.stream(params, { signal: request.signal });

    // Content-block index -> in-progress tool call (streaming state).
    const pendingToolCalls = new Map<number, { id: string; name: string; json: string }>();
    // Tool-call id -> finished call, kept for the whole request so the
    // `done` event's assistant parts can carry the same rawArguments/
    // parseError that were already streamed via tool_call_end.
    const finishedToolCalls = new Map<string, FinishedToolCall>();

    try {
      for await (const event of stream) {
        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'tool_use') {
              pendingToolCalls.set(event.index, { id: block.id, name: block.name, json: '' });
              yield { type: 'tool_call_start', id: block.id, name: block.name };
            }
            break;
          }
          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              yield { type: 'text_delta', text: delta.text };
            } else if (delta.type === 'input_json_delta') {
              const pending = pendingToolCalls.get(event.index);
              if (pending) {
                pending.json += delta.partial_json;
                yield { type: 'tool_call_delta', id: pending.id, argumentsDelta: delta.partial_json };
              }
            }
            // Other delta types (thinking_delta, signature_delta,
            // citations_delta) aren't part of this provider-neutral contract.
            break;
          }
          case 'content_block_stop': {
            const pending = pendingToolCalls.get(event.index);
            if (pending) {
              const { arguments: parsedArguments, parseError } = parseToolArguments(pending.json);
              finishedToolCalls.set(pending.id, { name: pending.name, rawArguments: pending.json, arguments: parsedArguments, parseError });
              yield {
                type: 'tool_call_end',
                id: pending.id,
                name: pending.name,
                arguments: parsedArguments,
                rawArguments: pending.json,
                parseError,
              };
              pendingToolCalls.delete(event.index);
            }
            break;
          }
          case 'message_delta': {
            yield {
              type: 'usage',
              inputTokens: event.usage.input_tokens ?? null,
              outputTokens: event.usage.output_tokens ?? null,
            };
            if (event.delta.stop_reason === 'refusal' && event.delta.stop_details?.explanation) {
              yield { type: 'text_delta', text: event.delta.stop_details.explanation };
            }
            break;
          }
          default:
            break;
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: 'done',
        stopReason: mapStopReason(finalMessage.stop_reason),
        assistant: buildAssistantParts(finalMessage.content, finishedToolCalls),
      };
    } catch (error) {
      const { code, message } = classifyError(error, request.signal);
      yield { type: 'error', code, message };
    }
  }
}
