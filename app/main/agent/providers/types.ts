import type { AgentModelInfo, AgentProviderId, JsonSchema } from '@lumacast/protocol';

// ---------------------------------------------------------------------------
// Provider-neutral request/response contract.
//
// Every LLM provider (Anthropic, OpenAI, Google Gemini, OpenRouter, and any
// OpenAI-compatible endpoint) is driven through this same shape from the
// agent runtime's point of view. A `ProviderAdapter` is the only thing that
// knows how to translate to/from a given provider's wire format; nothing
// above this layer (the agent loop, IPC handlers, etc.) should import a
// provider SDK directly.
// ---------------------------------------------------------------------------

/** A tool the agent runtime can offer to the model, described provider-neutrally as a JSON Schema input shape. */
export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

/** One piece of an assistant turn: either narrated text or a tool invocation the model requested. */
export type AssistantPart =
  | { type: 'text'; text: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      /** Parsed arguments, or `null` when `rawArguments` failed to parse as JSON (see `parseError`). */
      arguments: unknown;
      /** The exact accumulated argument string the model streamed, kept even when it fails to parse. */
      rawArguments: string;
      /** Set when `rawArguments` did not parse as JSON; `arguments` is `null` in that case. */
      parseError: string | null;
    };

/**
 * One turn of provider-neutral conversation history. `tool_results` always
 * carries every result for the tool calls issued in the preceding assistant
 * turn — adapters decide how that maps onto their wire format (one combined
 * message for Anthropic, one message per result for OpenAI-compatible
 * providers).
 */
export type ProviderMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; parts: AssistantPart[] }
  | { role: 'tool_results'; results: { toolCallId: string; content: string; isError: boolean }[] };

export interface ProviderChatRequest {
  model: string;
  system: string;
  messages: ProviderMessage[];
  tools: ProviderToolDefinition[];
  maxOutputTokens: number | null;
  signal: AbortSignal;
}

export type ProviderStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export type ProviderErrorCode = 'auth' | 'rate_limit' | 'invalid_model' | 'network' | 'provider' | 'aborted';

/**
 * Streamed while a `chat()` call is in flight. A well-behaved adapter emits
 * exactly one `done` (success) or one `error` (failure) as its final event,
 * never both.
 */
export type ProviderStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argumentsDelta: string }
  | { type: 'tool_call_end'; id: string; name: string; arguments: unknown; rawArguments: string; parseError: string | null }
  | { type: 'usage'; inputTokens: number | null; outputTokens: number | null }
  | { type: 'done'; stopReason: ProviderStopReason; assistant: AssistantPart[] }
  | { type: 'error'; code: ProviderErrorCode; message: string };

export interface ProviderAdapter {
  readonly id: AgentProviderId;
  listModels(signal?: AbortSignal): Promise<AgentModelInfo[]>;
  validateModel(modelId: string, signal?: AbortSignal): Promise<'valid' | 'not-found' | 'unknown'>;
  chat(request: ProviderChatRequest): AsyncIterable<ProviderStreamEvent>;
}

export interface ProviderAdapterOptions {
  apiKey: string;
  baseUrl: string | null;
}

/** A provider-neutral error, raised by adapter methods that return a `Promise` rather than a stream (`chat()` reports failures as an `error` stream event instead of throwing). */
export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
