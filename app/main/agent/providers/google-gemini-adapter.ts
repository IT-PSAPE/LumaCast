import type { AssistantPart, ProviderAdapterOptions, ProviderChatRequest, ProviderMessage, ProviderStopReason, ProviderStreamEvent } from './types';
import { withRequestTimeout } from './request-timeout';

const REQUEST_TIMEOUT_MS = 120_000;

interface GoogleGeminiDependencies {
  fetch: typeof fetch;
  requestTimeoutMs: number;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name: string; response: { result: string } };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { message?: string };
}

function toGeminiContents(messages: ProviderMessage[]): GeminiContent[] {
  const toolNames = new Map<string, string>();
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content }] });
      continue;
    }
    if (message.role === 'assistant') {
      const parts: GeminiPart[] = [];
      for (const part of message.parts) {
        if (part.type === 'text') {
          parts.push({ text: part.text });
        } else {
          toolNames.set(part.id, part.name);
          parts.push({ functionCall: { name: part.name, args: part.arguments } });
        }
      }
      contents.push({ role: 'model', parts });
      continue;
    }
    contents.push({
      role: 'user',
      parts: message.results.map((result) => ({
        functionResponse: {
          name: toolNames.get(result.toolCallId) ?? result.toolCallId,
          response: { result: result.content },
        },
      })),
    });
  }
  return contents;
}

function mapStopReason(reason: string | undefined, hasToolCalls: boolean): ProviderStopReason {
  if (hasToolCalls) return 'tool_use';
  if (reason === 'MAX_TOKENS') return 'max_tokens';
  if (reason === 'SAFETY' || reason === 'BLOCKLIST' || reason === 'PROHIBITED_CONTENT') return 'refusal';
  if (reason === 'STOP') return 'end_turn';
  return 'other';
}

async function* readSseData(response: Response): AsyncIterable<string> {
  if (!response.body) throw new Error('Gemini returned an empty response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') yield data;
    }
    if (done) break;
  }
  const trailing = buffer.trim();
  if (trailing.startsWith('data:')) {
    const data = trailing.slice(5).trimStart();
    if (data && data !== '[DONE]') yield data;
  }
}

function errorCodeForStatus(status: number): 'auth' | 'rate_limit' | 'invalid_model' | 'provider' {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'invalid_model';
  if (status === 429) return 'rate_limit';
  return 'provider';
}

export class GoogleGeminiAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(options: ProviderAdapterOptions, dependencies?: Partial<GoogleGeminiDependencies>) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.fetcher = dependencies?.fetch ?? globalThis.fetch;
    this.requestTimeoutMs = dependencies?.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  async *chat(request: ProviderChatRequest): AsyncIterable<ProviderStreamEvent> {
    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: toGeminiContents(request.messages),
      ...(request.tools.length ? {
        tools: [{
          functionDeclarations: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: tool.inputSchema,
          })),
        }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      } : {}),
      ...(request.maxOutputTokens == null ? {} : { generationConfig: { maxOutputTokens: request.maxOutputTokens } }),
    };

    let response: Response;
    const timeout = withRequestTimeout(request.signal, this.requestTimeoutMs);
    try {
      response = await this.fetcher(
        `${this.baseUrl}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify(body),
          signal: timeout.signal,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = request.signal.aborted;
      yield {
        type: 'error',
        code: aborted ? 'aborted' : 'network',
        message: timeout.didTimeout() ? `Request timed out after ${this.requestTimeoutMs}ms` : message,
      };
      timeout.dispose();
      return;
    }

    if (!response.ok) {
      try {
        const message = await response.text();
        yield { type: 'error', code: errorCodeForStatus(response.status), message: message || response.statusText || `HTTP ${response.status}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        yield {
          type: 'error',
          code: request.signal.aborted ? 'aborted' : timeout.didTimeout() ? 'network' : 'provider',
          message: timeout.didTimeout() ? `Request timed out after ${this.requestTimeoutMs}ms` : message,
        };
      } finally {
        timeout.dispose();
      }
      return;
    }

    try {
      const assistant: AssistantPart[] = [];
      const textChunks: string[] = [];
      let finishReason: string | undefined;
      let usage: { inputTokens: number | null; outputTokens: number | null } | null = null;
      let toolCallSequence = 0;

      for await (const data of readSseData(response)) {
        const chunk = JSON.parse(data) as GeminiStreamChunk;
        if (chunk.error?.message) {
          yield { type: 'error', code: 'provider', message: chunk.error.message };
          return;
        }
        for (const candidate of chunk.candidates ?? []) {
          if (candidate.finishReason) finishReason = candidate.finishReason;
          for (const part of candidate.content?.parts ?? []) {
            if (part.text) {
              textChunks.push(part.text);
              yield { type: 'text_delta', text: part.text };
            }
            if (part.functionCall?.name) {
              const id = `gemini-call-0-${toolCallSequence}`;
              toolCallSequence += 1;
              const rawArguments = JSON.stringify(part.functionCall.args ?? {});
              const toolPart: Extract<AssistantPart, { type: 'tool_call' }> = {
                type: 'tool_call',
                id,
                name: part.functionCall.name,
                arguments: part.functionCall.args ?? {},
                rawArguments,
                parseError: null,
              };
              yield { type: 'tool_call_start', id, name: toolPart.name };
              yield { type: 'tool_call_delta', id, argumentsDelta: rawArguments };
              yield {
                type: 'tool_call_end',
                id,
                name: toolPart.name,
                arguments: toolPart.arguments,
                rawArguments,
                parseError: null,
              };
              assistant.push(toolPart);
            }
          }
        }
        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount ?? null,
            outputTokens: chunk.usageMetadata.candidatesTokenCount ?? null,
          };
        }
      }

      if (!finishReason) {
        yield { type: 'error', code: 'provider', message: 'OpenCode Zen Gemini stream ended before completion' };
        return;
      }
      const text = textChunks.join('');
      if (text) assistant.unshift({ type: 'text', text });
      if (usage) yield { type: 'usage', ...usage };
      yield { type: 'done', stopReason: mapStopReason(finishReason, assistant.some((part) => part.type === 'tool_call')), assistant };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = request.signal.aborted;
      yield {
        type: 'error',
        code: aborted ? 'aborted' : timeout.didTimeout() ? 'network' : 'provider',
        message: timeout.didTimeout() ? `Request timed out after ${this.requestTimeoutMs}ms` : message,
      };
    } finally {
      timeout.dispose();
    }
  }
}
