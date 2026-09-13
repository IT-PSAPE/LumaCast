// @vitest-environment node
import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { OpenAiResponsesAdapter } from '../../../../../app/main/agent/providers/openai-responses-adapter';
import type { ProviderChatRequest, ProviderStreamEvent } from '../../../../../app/main/agent/providers/types';

vi.mock('openai', () => {
  class FakeAPIError extends Error {}
  class FakeAuthenticationError extends FakeAPIError {}
  class FakeRateLimitError extends FakeAPIError {}
  class FakeNotFoundError extends FakeAPIError {}
  class FakeAPIConnectionError extends FakeAPIError {}
  class FakeAPIUserAbortError extends FakeAPIError {}

  class FakeOpenAI {
    static APIError = FakeAPIError;
    static AuthenticationError = FakeAuthenticationError;
    static RateLimitError = FakeRateLimitError;
    static NotFoundError = FakeNotFoundError;
    static APIConnectionError = FakeAPIConnectionError;
    static APIUserAbortError = FakeAPIUserAbortError;
    static instances: FakeOpenAI[] = [];

    responses = { create: vi.fn() };

    constructor(public options: unknown) {
      FakeOpenAI.instances.push(this);
    }
  }

  return { default: FakeOpenAI };
});

function latestInstance(): {
  options: { apiKey: string; baseURL: string; maxRetries: number; timeout: number };
  responses: { create: ReturnType<typeof vi.fn> };
} {
  return (OpenAI as unknown as { instances: unknown[] }).instances.at(-1) as never;
}

function request(overrides: Partial<ProviderChatRequest> = {}): ProviderChatRequest {
  return {
    model: 'gpt-5.6-sol',
    system: 'System prompt',
    messages: [{ role: 'user', content: 'Hello' }],
    tools: [],
    maxOutputTokens: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function stream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) yield event;
    },
  };
}

async function collect(iterable: AsyncIterable<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('OpenAiResponsesAdapter', () => {
  it('uses the Zen base URL and maps conversation history into Responses input items', async () => {
    const adapter = new OpenAiResponsesAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });
    const instance = latestInstance();
    instance.responses.create.mockResolvedValue(stream([
      { type: 'response.completed', response: { status: 'completed', output: [], usage: null } },
    ]));
    const chatRequest = request({
      messages: [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Checking.' },
            { type: 'tool_call', id: 'call-1', name: 'search', arguments: { q: 'news' }, rawArguments: '{"q":"news"}', parseError: null },
          ],
        },
        { role: 'tool_results', results: [{ toolCallId: 'call-1', content: 'Done', isError: false }] },
      ],
      tools: [{ name: 'search', description: 'Search content', inputSchema: { type: 'object', properties: {} } }],
      maxOutputTokens: 4096,
    });

    await collect(adapter.chat(chatRequest));

    expect(instance.options).toMatchObject({ apiKey: 'zen-key', baseURL: 'https://opencode.ai/zen/v1' });
    expect(instance.responses.create).toHaveBeenCalledWith({
      model: 'gpt-5.6-sol',
      instructions: 'System prompt',
      input: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Checking.' },
        { type: 'function_call', call_id: 'call-1', name: 'search', arguments: '{"q":"news"}' },
        { type: 'function_call_output', call_id: 'call-1', output: 'Done' },
      ],
      stream: true,
      max_output_tokens: 4096,
      tools: [{ type: 'function', name: 'search', description: 'Search content', parameters: { type: 'object', properties: {} }, strict: false }],
      tool_choice: 'auto',
    }, { signal: chatRequest.signal });
  });

  it('streams text, tool calls, usage, and a tool-use completion', async () => {
    const adapter = new OpenAiResponsesAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });
    latestInstance().responses.create.mockResolvedValue(stream([
      { type: 'response.output_text.delta', delta: 'Hello' },
      { type: 'response.output_item.added', item: { id: 'item-1', type: 'function_call', call_id: 'call-1', name: 'search', arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"q":' },
      { type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '"news"}' },
      { type: 'response.output_item.done', item: { id: 'item-1', type: 'function_call', call_id: 'call-1', name: 'search', arguments: '{"q":"news"}' } },
      { type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call' }], usage: { input_tokens: 12, output_tokens: 5 } } },
    ]));

    await expect(collect(adapter.chat(request()))).resolves.toEqual([
      { type: 'text_delta', text: 'Hello' },
      { type: 'tool_call_start', id: 'call-1', name: 'search' },
      { type: 'tool_call_delta', id: 'call-1', argumentsDelta: '{"q":' },
      { type: 'tool_call_delta', id: 'call-1', argumentsDelta: '"news"}' },
      { type: 'tool_call_end', id: 'call-1', name: 'search', arguments: { q: 'news' }, rawArguments: '{"q":"news"}', parseError: null },
      { type: 'usage', inputTokens: 12, outputTokens: 5 },
      {
        type: 'done',
        stopReason: 'tool_use',
        assistant: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_call', id: 'call-1', name: 'search', arguments: { q: 'news' }, rawArguments: '{"q":"news"}', parseError: null },
        ],
      },
    ]);
  });

  it('maps incomplete and failed response events', async () => {
    const incomplete = new OpenAiResponsesAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });
    latestInstance().responses.create.mockResolvedValue(stream([
      {
        type: 'response.incomplete',
        response: {
          status: 'incomplete',
          output: [],
          usage: null,
          incomplete_details: { reason: 'max_output_tokens' },
        },
      },
    ]));
    await expect(collect(incomplete.chat(request()))).resolves.toEqual([
      { type: 'done', stopReason: 'max_tokens', assistant: [] },
    ]);

    const failed = new OpenAiResponsesAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });
    latestInstance().responses.create.mockResolvedValue(stream([
      { type: 'response.failed', response: { error: { message: 'upstream failed' } } },
    ]));
    await expect(collect(failed.chat(request()))).resolves.toEqual([
      { type: 'error', code: 'provider', message: 'upstream failed' },
    ]);
  });

  it('reports a provider error when the stream ends without a terminal event', async () => {
    const adapter = new OpenAiResponsesAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });
    latestInstance().responses.create.mockResolvedValue(stream([
      { type: 'response.output_text.delta', delta: 'truncated' },
    ]));

    await expect(collect(adapter.chat(request()))).resolves.toEqual([
      { type: 'text_delta', text: 'truncated' },
      { type: 'error', code: 'provider', message: 'OpenCode Zen response stream ended before completion' },
    ]);
  });

  it.each([
    ['AuthenticationError', 'auth'],
    ['RateLimitError', 'rate_limit'],
    ['NotFoundError', 'invalid_model'],
    ['APIConnectionError', 'network'],
    ['APIError', 'provider'],
  ] as const)('maps OpenAI %s to code %s', async (errorClassName, expectedCode) => {
    const adapter = new OpenAiResponsesAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });
    const ErrorClass = (OpenAI as unknown as Record<string, new (message: string) => Error>)[errorClassName];
    latestInstance().responses.create.mockRejectedValue(new ErrorClass('boom'));

    await expect(collect(adapter.chat(request()))).resolves.toEqual([
      { type: 'error', code: expectedCode, message: 'boom' },
    ]);
  });

  it('maps an aborted request to code aborted', async () => {
    const adapter = new OpenAiResponsesAdapter({ apiKey: 'zen-key', baseUrl: 'https://opencode.ai/zen/v1' });
    latestInstance().responses.create.mockRejectedValue(new Error('stream closed'));
    const controller = new AbortController();
    controller.abort();

    await expect(collect(adapter.chat(request({ signal: controller.signal })))).resolves.toEqual([
      { type: 'error', code: 'aborted', message: 'stream closed' },
    ]);
  });
});
