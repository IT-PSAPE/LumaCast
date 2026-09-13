// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleGeminiAdapter } from '../../../../../app/main/agent/providers/google-gemini-adapter';
import type { ProviderChatRequest, ProviderStreamEvent } from '../../../../../app/main/agent/providers/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(): ProviderChatRequest {
  return {
    model: 'gemini-3-flash',
    system: 'System prompt',
    messages: [
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_call', id: 'call-previous', name: 'search', arguments: { q: 'news' }, rawArguments: '{"q":"news"}', parseError: null },
        ],
      },
      { role: 'tool_results', results: [{ toolCallId: 'call-previous', content: 'Found it', isError: false }] },
    ],
    tools: [{ name: 'search', description: 'Search content', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }],
    maxOutputTokens: 4096,
    signal: new AbortController().signal,
  };
}

async function collect(iterable: AsyncIterable<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('GoogleGeminiAdapter', () => {
  it('maps history and tools to Gemini and streams text, a function call, usage, and completion', async () => {
    const fetcher = vi.fn(async () => new Response([
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello' }] } }] })}`,
      `data: ${JSON.stringify({
        candidates: [{
          content: { parts: [{ functionCall: { name: 'search', args: { q: 'weather' } } }] },
          finishReason: 'STOP',
        }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 },
      })}`,
      '',
    ].join('\n\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetcher);
    const adapter = new GoogleGeminiAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });
    const chatRequest = request();

    await expect(collect(adapter.chat(chatRequest))).resolves.toEqual([
      { type: 'text_delta', text: 'Hello' },
      { type: 'tool_call_start', id: 'gemini-call-0-0', name: 'search' },
      { type: 'tool_call_delta', id: 'gemini-call-0-0', argumentsDelta: '{"q":"weather"}' },
      { type: 'tool_call_end', id: 'gemini-call-0-0', name: 'search', arguments: { q: 'weather' }, rawArguments: '{"q":"weather"}', parseError: null },
      { type: 'usage', inputTokens: 9, outputTokens: 4 },
      {
        type: 'done',
        stopReason: 'tool_use',
        assistant: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_call', id: 'gemini-call-0-0', name: 'search', arguments: { q: 'weather' }, rawArguments: '{"q":"weather"}', parseError: null },
        ],
      },
    ]);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://opencode.ai/zen/v1/models/gemini-3-flash:streamGenerateContent?alt=sse');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': 'zen-key' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(chatRequest.signal);
    expect(init.signal?.aborted).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({
      systemInstruction: { parts: [{ text: 'System prompt' }] },
      contents: [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Checking.' }, { functionCall: { name: 'search', args: { q: 'news' } } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'search', response: { result: 'Found it' } } }] },
      ],
      tools: [{ functionDeclarations: [{ name: 'search', description: 'Search content', parametersJsonSchema: { type: 'object', properties: { q: { type: 'string' } } } }] }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: { maxOutputTokens: 4096 },
    });
  });

  it.each([
    [401, 'auth'],
    [404, 'invalid_model'],
    [429, 'rate_limit'],
    [503, 'provider'],
  ] as const)('maps an HTTP %s response to code %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream error', { status })));
    const adapter = new GoogleGeminiAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });

    await expect(collect(adapter.chat(request()))).resolves.toEqual([
      { type: 'error', code, message: 'upstream error' },
    ]);
  });

  it('classifies malformed stream data as a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));
    const adapter = new GoogleGeminiAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });

    const events = await collect(adapter.chat(request()));

    expect(events).toEqual([{ type: 'error', code: 'provider', message: expect.any(String) }]);
  });

  it('classifies transport failure and cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const networkAdapter = new GoogleGeminiAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });
    await expect(collect(networkAdapter.chat(request()))).resolves.toEqual([
      { type: 'error', code: 'network', message: 'offline' },
    ]);

    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('cancelled', 'AbortError'); }));
    const abortedAdapter = new GoogleGeminiAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });
    await expect(collect(abortedAdapter.chat({ ...request(), signal: controller.signal }))).resolves.toEqual([
      { type: 'error', code: 'aborted', message: 'cancelled' },
    ]);
  });

  it('times out a request whose transport never completes', async () => {
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const adapter = new GoogleGeminiAdapter(
      { apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' },
      { fetch: fetcher as typeof fetch, requestTimeoutMs: 1 },
    );

    await expect(collect(adapter.chat(request()))).resolves.toEqual([
      { type: 'error', code: 'network', message: 'Request timed out after 1ms' },
    ]);
  });

  it.each([
    ['', []],
    ['data: {"candidates":[{"content":{"parts":[{"text":"truncated"}]}}]}\n\n', [
      { type: 'text_delta', text: 'truncated' },
    ]],
  ] as const)('reports a provider error when a stream ends without a finish reason', async (body, prefix) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })));
    const adapter = new GoogleGeminiAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });

    await expect(collect(adapter.chat(request()))).resolves.toEqual([
      ...prefix,
      { type: 'error', code: 'provider', message: 'OpenCode Zen Gemini stream ended before completion' },
    ]);
  });
});
