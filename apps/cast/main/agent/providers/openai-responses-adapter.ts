import OpenAI from 'openai';
import type {
  AssistantPart,
  ProviderAdapterOptions,
  ProviderChatRequest,
  ProviderErrorCode,
  ProviderMessage,
  ProviderStopReason,
  ProviderStreamEvent,
} from './types';

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

function toResponsesInput(messages: ProviderMessage[]): OpenAI.Responses.ResponseInput {
  const input: OpenAI.Responses.ResponseInput = [];
  for (const message of messages) {
    if (message.role === 'user') {
      input.push({ role: 'user', content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const text = message.parts
        .filter((part): part is Extract<AssistantPart, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('');
      if (text) input.push({ role: 'assistant', content: text });
      for (const part of message.parts) {
        if (part.type === 'tool_call') {
          input.push({ type: 'function_call', call_id: part.id, name: part.name, arguments: part.rawArguments });
        }
      }
      continue;
    }
    for (const result of message.results) {
      input.push({ type: 'function_call_output', call_id: result.toolCallId, output: result.content });
    }
  }
  return input;
}

function parseArguments(rawArguments: string): { arguments: unknown; parseError: string | null } {
  if (!rawArguments.trim()) return { arguments: {}, parseError: null };
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
  if (signal?.aborted || isAbortError(error)) return { code: 'aborted', message };
  if (error instanceof OpenAI.AuthenticationError) return { code: 'auth', message };
  if (error instanceof OpenAI.RateLimitError) return { code: 'rate_limit', message };
  if (error instanceof OpenAI.NotFoundError) return { code: 'invalid_model', message };
  if (error instanceof OpenAI.APIConnectionError) return { code: 'network', message };
  return { code: 'provider', message };
}

function stopReason(response: OpenAI.Responses.Response): ProviderStopReason {
  if (response.output.some((item) => item.type === 'function_call')) return 'tool_use';
  if (response.incomplete_details?.reason === 'max_output_tokens') return 'max_tokens';
  if (response.incomplete_details?.reason === 'content_filter') return 'refusal';
  return response.status === 'completed' ? 'end_turn' : 'other';
}

interface PendingToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export class OpenAiResponsesAdapter {
  private readonly client: OpenAI;

  constructor(options: ProviderAdapterOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl ?? undefined,
      maxRetries: MAX_RETRIES,
      timeout: REQUEST_TIMEOUT_MS,
    });
  }

  async *chat(request: ProviderChatRequest): AsyncIterable<ProviderStreamEvent> {
    const tools: OpenAI.Responses.FunctionTool[] = request.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    }));
    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: request.model,
      instructions: request.system,
      input: toResponsesInput(request.messages),
      stream: true,
      max_output_tokens: request.maxOutputTokens ?? undefined,
      ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
    };
    const textChunks: string[] = [];
    const pending = new Map<string, PendingToolCall>();
    const assistant: AssistantPart[] = [];

    try {
      const stream = await this.client.responses.create(params, { signal: request.signal });
      for await (const event of stream) {
        switch (event.type) {
          case 'response.output_text.delta':
            textChunks.push(event.delta);
            yield { type: 'text_delta', text: event.delta };
            break;
          case 'response.output_item.added':
            if (event.item.type === 'function_call') {
              const itemId = event.item.id ?? event.item.call_id;
              pending.set(itemId, { callId: event.item.call_id, name: event.item.name, arguments: event.item.arguments ?? '' });
              yield { type: 'tool_call_start', id: event.item.call_id, name: event.item.name };
            }
            break;
          case 'response.function_call_arguments.delta': {
            const toolCall = pending.get(event.item_id);
            if (toolCall) {
              toolCall.arguments += event.delta;
              yield { type: 'tool_call_delta', id: toolCall.callId, argumentsDelta: event.delta };
            }
            break;
          }
          case 'response.output_item.done':
            if (event.item.type === 'function_call') {
              const itemId = event.item.id ?? event.item.call_id;
              const toolCall = pending.get(itemId) ?? {
                callId: event.item.call_id,
                name: event.item.name,
                arguments: event.item.arguments,
              };
              const rawArguments = event.item.arguments || toolCall.arguments;
              const parsed = parseArguments(rawArguments);
              const part: Extract<AssistantPart, { type: 'tool_call' }> = {
                type: 'tool_call',
                id: toolCall.callId,
                name: toolCall.name,
                arguments: parsed.arguments,
                rawArguments,
                parseError: parsed.parseError,
              };
              assistant.push(part);
              pending.delete(itemId);
              yield {
                type: 'tool_call_end',
                id: part.id,
                name: part.name,
                arguments: part.arguments,
                rawArguments: part.rawArguments,
                parseError: part.parseError,
              };
            }
            break;
          case 'response.completed':
          case 'response.incomplete': {
            const text = textChunks.join('');
            if (text) assistant.unshift({ type: 'text', text });
            if (event.response.usage) {
              yield {
                type: 'usage',
                inputTokens: event.response.usage.input_tokens,
                outputTokens: event.response.usage.output_tokens,
              };
            }
            yield { type: 'done', stopReason: stopReason(event.response), assistant };
            return;
          }
          case 'error':
            yield { type: 'error', code: 'provider', message: event.message };
            return;
          case 'response.failed':
            yield { type: 'error', code: 'provider', message: event.response.error?.message ?? 'OpenCode Zen response failed' };
            return;
          default:
            break;
        }
      }
      yield { type: 'error', code: 'provider', message: 'OpenCode Zen response stream ended before completion' };
    } catch (error) {
      const classified = classifyError(error, request.signal);
      yield { type: 'error', ...classified };
    }
  }
}
