import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenCodeZenAdapter } from '../../../../../app/main/agent/providers/opencode-zen-adapter';
import type { ProviderChatRequest, ProviderStreamEvent } from '../../../../../app/main/agent/providers/types';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenCodeZenAdapter model catalog', () => {
  it('returns live Zen models with display names, free status, capabilities, and alphabetical ordering', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://opencode.ai/zen/v1/models') {
        return jsonResponse({
          object: 'list',
          data: [
            { id: 'gpt-5.6-sol', object: 'model', created: 1, owned_by: 'opencode' },
            { id: 'big-pickle', object: 'model', created: 1, owned_by: 'opencode' },
            { id: 'claude-sonnet-4-6', object: 'model', created: 1, owned_by: 'opencode' },
          ],
        });
      }
      if (url === 'https://models.dev/api.json') {
        return jsonResponse({
          opencode: {
            models: {
              'gpt-5.6-sol': {
                name: 'GPT-5.6 Sol',
                tool_call: true,
                limit: { context: 1_050_000, output: 128_000 },
                provider: { npm: '@ai-sdk/openai' },
                cost: { input: 2, output: 10 },
              },
              'big-pickle': {
                name: 'Big Pickle',
                tool_call: true,
                limit: { context: 200_000, output: 32_000 },
                cost: { input: 0, output: 0 },
              },
              'claude-sonnet-4-6': {
                name: 'Claude Sonnet 4.6',
                tool_call: true,
                limit: { context: 1_000_000, output: 64_000 },
                provider: { npm: '@ai-sdk/anthropic' },
                cost: { input: 3, output: 15 },
              },
            },
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }));

    const adapter = new OpenCodeZenAdapter({ apiKey: 'test-key', baseUrl: null });

    await expect(adapter.listModels()).resolves.toEqual([
      {
        id: 'big-pickle',
        label: 'Big Pickle',
        contextWindow: 200_000,
        maxOutputTokens: 32_000,
        supportsTools: true,
        isFree: true,
        vendor: 'opencode',
      },
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        contextWindow: 1_000_000,
        maxOutputTokens: 64_000,
        supportsTools: true,
        isFree: false,
        vendor: 'anthropic',
      },
      {
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        contextWindow: 1_050_000,
        maxOutputTokens: 128_000,
        supportsTools: true,
        isFree: false,
        vendor: 'openai',
      },
    ]);
  });

  it('keeps the live catalog usable when optional display metadata is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input) === 'https://opencode.ai/zen/v1/models') {
        return jsonResponse({ data: [{ id: 'mimo-v2.5-free' }, { id: 'gemini-3-flash' }] });
      }
      return jsonResponse({ error: 'down' }, 503);
    }));

    const adapter = new OpenCodeZenAdapter({ apiKey: 'test-key', baseUrl: null });

    await expect(adapter.listModels()).resolves.toEqual([
      {
        id: 'gemini-3-flash',
        label: 'Gemini 3 Flash',
        contextWindow: null,
        maxOutputTokens: null,
        supportsTools: true,
        isFree: false,
        vendor: 'google',
      },
      {
        id: 'mimo-v2.5-free',
        label: 'Mimo V2.5 Free',
        contextWindow: null,
        maxOutputTokens: null,
        supportsTools: true,
        isFree: true,
        vendor: null,
      },
    ]);
  });

  it('retries optional display metadata after a transient failure', async () => {
    let metadataAttempts = 0;
    const adapter = new OpenCodeZenAdapter(
      { apiKey: 'test-key', baseUrl: null },
      {
        fetch: vi.fn(async (input: string | URL | Request) => {
          if (String(input) === 'https://opencode.ai/zen/v1/models') return jsonResponse({ data: [{ id: 'big-pickle' }] });
          metadataAttempts += 1;
          if (metadataAttempts === 1) return jsonResponse({}, 503);
          return jsonResponse({ opencode: { models: { 'big-pickle': { name: 'Big Pickle', cost: { input: 0, output: 0 } } } } });
        }),
      },
    );

    await expect(adapter.listModels()).resolves.toMatchObject([{ label: 'Big Pickle' }]);
    await expect(adapter.listModels()).resolves.toMatchObject([{ label: 'Big Pickle' }]);
    expect(metadataAttempts).toBe(2);
  });

  it('never sends the Zen credential to Models.dev', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
      if (String(input) === 'https://opencode.ai/zen/v1/models') return jsonResponse({ data: [] });
      return jsonResponse({ opencode: { models: {} } });
    });
    const adapter = new OpenCodeZenAdapter({ apiKey: 'test-key', baseUrl: null }, { fetch: fetcher });

    await adapter.listModels();

    const metadataCall = fetcher.mock.calls.find(([input]) => String(input) === 'https://models.dev/api.json');
    expect(metadataCall?.[1]?.headers).toBeUndefined();
  });

  it.each([
    [401, 'auth'],
    [429, 'rate_limit'],
    [503, 'provider'],
  ] as const)('classifies an HTTP %s catalog failure as %s', async (status, code) => {
    const adapter = new OpenCodeZenAdapter(
      { apiKey: 'test-key', baseUrl: null },
      { fetch: vi.fn(async () => jsonResponse({}, status)) },
    );

    await expect(adapter.listModels()).rejects.toMatchObject({ code, status });
  });

  it('classifies a malformed live catalog as a provider error', async () => {
    const adapter = new OpenCodeZenAdapter(
      { apiKey: 'test-key', baseUrl: null },
      { fetch: vi.fn(async () => new Response('{', { status: 200 })) },
    );

    await expect(adapter.listModels()).rejects.toMatchObject({ code: 'provider' });
  });

  it('classifies catalog transport failures and cancellation', async () => {
    const networkAdapter = new OpenCodeZenAdapter(
      { apiKey: 'test-key', baseUrl: null },
      { fetch: vi.fn(async () => { throw new Error('offline'); }) },
    );
    await expect(networkAdapter.listModels()).rejects.toMatchObject({ code: 'network' });

    const controller = new AbortController();
    controller.abort();
    const abortedAdapter = new OpenCodeZenAdapter(
      { apiKey: 'test-key', baseUrl: null },
      { fetch: vi.fn(async () => { throw new DOMException('cancelled', 'AbortError'); }) },
    );
    await expect(abortedAdapter.listModels(controller.signal)).rejects.toMatchObject({ code: 'aborted' });
  });

  it('times out catalog loading when the endpoint never completes', async () => {
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const adapter = new OpenCodeZenAdapter(
      { apiKey: 'test-key', baseUrl: null },
      { fetch: fetcher as typeof fetch, requestTimeoutMs: 1 },
    );

    await expect(adapter.listModels()).rejects.toMatchObject({ code: 'network', message: 'Request timed out after 1ms' });
  });
});

function chatRequest(model: string): ProviderChatRequest {
  return {
    model,
    system: 'system',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
    maxOutputTokens: null,
    signal: new AbortController().signal,
  };
}

async function collect(iterable: AsyncIterable<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('OpenCodeZenAdapter protocol routing', () => {
  it.each([
    ['gpt-5.6-sol', '@ai-sdk/openai', 'responses'],
    ['claude-sonnet-4-6', '@ai-sdk/anthropic', 'messages'],
    ['gemini-3-flash', '@ai-sdk/google', 'gemini'],
    ['minimax-m3', null, 'chat-completions'],
  ] as const)('routes %s through its catalog-declared protocol', async (modelId, npmPackage, expectedProtocol) => {
    const protocols: string[] = [];
    const delegate = {
      async *chat(): AsyncIterable<ProviderStreamEvent> {
        yield { type: 'done', stopReason: 'end_turn', assistant: [] };
      },
    };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === 'https://models.dev/api.json') {
        return jsonResponse({
          opencode: {
            models: {
              [modelId]: {
                name: modelId,
                ...(npmPackage ? { provider: { npm: npmPackage } } : {}),
              },
            },
          },
        });
      }
      throw new Error(`Unexpected URL: ${String(input)}`);
    });
    const adapter = new OpenCodeZenAdapter(
      { apiKey: 'test-key', baseUrl: null },
      {
        fetch: fetcher,
        createDelegate: (protocol) => {
          protocols.push(protocol);
          return delegate;
        },
      },
    );

    await expect(collect(adapter.chat(chatRequest(modelId)))).resolves.toEqual([
      { type: 'done', stopReason: 'end_turn', assistant: [] },
    ]);
    expect(protocols).toEqual([expectedProtocol]);
  });
});
