// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicAdapter } from '../../../../../app/main/agent/providers/anthropic-adapter';
import type { ProviderChatRequest, ProviderStreamEvent } from '../../../../../app/main/agent/providers/types';

// ---------------------------------------------------------------------------
// Fake @anthropic-ai/sdk. Every constructed instance is pushed onto the
// static `instances` array so tests can grab the freshly-created client and
// drive its `models.list` / `models.retrieve` / `messages.stream` mocks.
// ---------------------------------------------------------------------------
vi.mock('@anthropic-ai/sdk', () => {
  class FakeAPIError extends Error {}
  class FakeAuthenticationError extends FakeAPIError {}
  class FakeRateLimitError extends FakeAPIError {}
  class FakeNotFoundError extends FakeAPIError {}
  class FakeAPIConnectionError extends FakeAPIError {}
  class FakeAPIUserAbortError extends FakeAPIError {}

  class FakeAnthropic {
    static APIError = FakeAPIError;
    static AuthenticationError = FakeAuthenticationError;
    static RateLimitError = FakeRateLimitError;
    static NotFoundError = FakeNotFoundError;
    static APIConnectionError = FakeAPIConnectionError;
    static APIUserAbortError = FakeAPIUserAbortError;
    static instances: FakeAnthropic[] = [];

    options: unknown;
    models = { list: vi.fn(), retrieve: vi.fn() };
    messages = { stream: vi.fn() };

    constructor(options: unknown) {
      this.options = options;
      FakeAnthropic.instances.push(this);
    }
  }

  return { default: FakeAnthropic };
});

function latestInstance(): {
  options: { apiKey: string; baseURL: string | undefined; maxRetries: number; timeout: number };
  models: { list: ReturnType<typeof vi.fn>; retrieve: ReturnType<typeof vi.fn> };
  messages: { stream: ReturnType<typeof vi.fn> };
} {
  return (Anthropic as unknown as { instances: unknown[] }).instances.at(-1) as never;
}

function fakeStream(events: unknown[], finalMessage: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const event of events) yield event;
    },
    finalMessage: async () => finalMessage,
  };
}

function fakeErrorStream(error: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      throw error;
    },
    finalMessage: async () => {
      throw error;
    },
  };
}

function fakeFinalMessage(content: unknown[], stopReason: string | null) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content,
    model: 'claude-opus-5',
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function textDeltaEvent(index: number, text: string) {
  return { type: 'content_block_delta', index, delta: { type: 'text_delta', text } };
}

function toolUseStartEvent(index: number, id: string, name: string) {
  return { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } };
}

function toolUseDeltaEvent(index: number, partialJson: string) {
  return { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partialJson } };
}

function contentBlockStopEvent(index: number) {
  return { type: 'content_block_stop', index };
}

function messageDeltaEvent(
  stopReason: string | null,
  usage: { input_tokens?: number | null; output_tokens?: number | null } = {},
  stopDetails: { explanation?: string } | null = null,
) {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails },
    usage: { input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null },
  };
}

function buildRequest(overrides: Partial<ProviderChatRequest> = {}): ProviderChatRequest {
  return {
    model: 'claude-opus-5',
    system: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
    maxOutputTokens: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collect(iterable: AsyncIterable<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

function newAdapter() {
  const adapter = new AnthropicAdapter({ apiKey: 'test-key', baseUrl: null });
  return { adapter, instance: latestInstance() };
}

describe('AnthropicAdapter request shape mapping', () => {
  it('maps system, tools, and every message kind to the Anthropic wire format', async () => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(fakeStream([], fakeFinalMessage([{ type: 'text', text: 'ok' }], 'end_turn')));

    const request = buildRequest({
      system: 'System prompt',
      tools: [{ name: 'search', description: 'Searches things', inputSchema: { type: 'object', properties: {} } }],
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_call', id: 'call_1', name: 'search', arguments: { q: 'weather' }, rawArguments: '{"q":"weather"}', parseError: null },
          ],
        },
        {
          role: 'tool_results',
          results: [
            { toolCallId: 'call_1', content: 'sunny', isError: false },
            { toolCallId: 'call_2', content: 'oops', isError: true },
          ],
        },
      ],
      maxOutputTokens: 2048,
    });

    await collect(adapter.chat(request));

    expect(instance.messages.stream).toHaveBeenCalledTimes(1);
    const [params, options] = instance.messages.stream.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];

    expect(params.model).toBe(request.model);
    expect(params.system).toBe('System prompt');
    expect(params.max_tokens).toBe(2048);
    expect(params.cache_control).toEqual({ type: 'ephemeral' });
    expect(params.tool_choice).toEqual({ type: 'auto' });
    expect(params.tools).toEqual([{ name: 'search', description: 'Searches things', input_schema: { type: 'object', properties: {} } }]);
    expect(params.messages).toEqual([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'weather' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', content: 'sunny', is_error: false },
          { type: 'tool_result', tool_use_id: 'call_2', content: 'oops', is_error: true },
        ],
      },
    ]);
    expect(options).toEqual({ signal: request.signal });
  });

  it('omits tools/tool_choice entirely when no tools are configured', async () => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(fakeStream([], fakeFinalMessage([], 'end_turn')));

    await collect(adapter.chat(buildRequest({ tools: [] })));

    const [params] = instance.messages.stream.mock.calls[0] as [Record<string, unknown>];
    expect(params.tools).toBeUndefined();
    expect(params.tool_choice).toBeUndefined();
  });

  it('defaults max_tokens to 8192 when maxOutputTokens is null', async () => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(fakeStream([], fakeFinalMessage([], 'end_turn')));

    await collect(adapter.chat(buildRequest({ maxOutputTokens: null })));

    const [params] = instance.messages.stream.mock.calls[0] as [Record<string, unknown>];
    expect(params.max_tokens).toBe(8192);
    expect(params.thinking).toBeUndefined();
  });
});

describe('AnthropicAdapter text streaming', () => {
  it('emits a text_delta event per streamed fragment', async () => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(
      fakeStream([textDeltaEvent(0, 'Hello'), textDeltaEvent(0, ', world')], fakeFinalMessage([{ type: 'text', text: 'Hello, world' }], 'end_turn')),
    );

    const events = await collect(adapter.chat(buildRequest()));

    expect(events.filter((event) => event.type === 'text_delta')).toEqual([
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ', world' },
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn', assistant: [{ type: 'text', text: 'Hello, world' }] });
  });
});

describe('AnthropicAdapter tool call streaming', () => {
  it('streams a single tool call across fragments and parses the final arguments', async () => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(
      fakeStream(
        [toolUseStartEvent(0, 'call_1', 'search'), toolUseDeltaEvent(0, '{"q":'), toolUseDeltaEvent(0, '"weather"}'), contentBlockStopEvent(0)],
        fakeFinalMessage([{ type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'weather' } }], 'tool_use'),
      ),
    );

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toEqual([
      { type: 'tool_call_start', id: 'call_1', name: 'search' },
      { type: 'tool_call_delta', id: 'call_1', argumentsDelta: '{"q":' },
      { type: 'tool_call_delta', id: 'call_1', argumentsDelta: '"weather"}' },
      { type: 'tool_call_end', id: 'call_1', name: 'search', arguments: { q: 'weather' }, rawArguments: '{"q":"weather"}', parseError: null },
      {
        type: 'done',
        stopReason: 'tool_use',
        assistant: [{ type: 'tool_call', id: 'call_1', name: 'search', arguments: { q: 'weather' }, rawArguments: '{"q":"weather"}', parseError: null }],
      },
    ]);
  });

  it('tracks two parallel tool calls independently when their fragments interleave', async () => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(
      fakeStream(
        [
          toolUseStartEvent(0, 'call_1', 'search'),
          toolUseStartEvent(1, 'call_2', 'weather'),
          toolUseDeltaEvent(0, '{"q":"a"}'),
          toolUseDeltaEvent(1, '{"city":"b"}'),
          contentBlockStopEvent(0),
          contentBlockStopEvent(1),
        ],
        fakeFinalMessage(
          [
            { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'a' } },
            { type: 'tool_use', id: 'call_2', name: 'weather', input: { city: 'b' } },
          ],
          'tool_use',
        ),
      ),
    );

    const events = await collect(adapter.chat(buildRequest()));

    const toolCallEnds = events.filter((event) => event.type === 'tool_call_end');
    expect(toolCallEnds).toEqual([
      { type: 'tool_call_end', id: 'call_1', name: 'search', arguments: { q: 'a' }, rawArguments: '{"q":"a"}', parseError: null },
      { type: 'tool_call_end', id: 'call_2', name: 'weather', arguments: { city: 'b' }, rawArguments: '{"city":"b"}', parseError: null },
    ]);
    const done = events.at(-1) as { type: 'done'; assistant: unknown[] };
    expect(done.assistant).toHaveLength(2);
  });

  it('reports a parse error for malformed JSON arguments instead of throwing', async () => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(
      fakeStream(
        [toolUseStartEvent(0, 'call_1', 'search'), toolUseDeltaEvent(0, '{"q": not-json'), contentBlockStopEvent(0)],
        fakeFinalMessage([{ type: 'tool_use', id: 'call_1', name: 'search', input: null }], 'tool_use'),
      ),
    );

    const events = await collect(adapter.chat(buildRequest()));

    const toolCallEnd = events.find((event) => event.type === 'tool_call_end') as { arguments: unknown; parseError: string | null };
    expect(toolCallEnd.arguments).toBeNull();
    expect(toolCallEnd.parseError).toEqual(expect.any(String));
  });
});

describe('AnthropicAdapter stop reason mapping', () => {
  it.each([
    ['end_turn', 'end_turn'],
    ['tool_use', 'tool_use'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'other'],
    ['stop_sequence', 'other'],
    ['model_context_window_exceeded', 'other'],
    [null, 'other'],
  ] as const)('maps Anthropic stop_reason %s to %s', async (anthropicReason, expected) => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(fakeStream([], fakeFinalMessage([{ type: 'text', text: 'done' }], anthropicReason)));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: expected });
  });

  it('includes stop_details.explanation as a trailing text_delta on refusal', async () => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(
      fakeStream([messageDeltaEvent('refusal', {}, { explanation: 'Cannot help with that.' })], fakeFinalMessage([], 'refusal')),
    );

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toContainEqual({ type: 'text_delta', text: 'Cannot help with that.' });
  });

  it('emits a usage event from message_delta', async () => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(fakeStream([messageDeltaEvent(null, { input_tokens: 12, output_tokens: 34 })], fakeFinalMessage([], 'end_turn')));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toContainEqual({ type: 'usage', inputTokens: 12, outputTokens: 34 });
  });
});

describe('AnthropicAdapter error mapping', () => {
  it.each([
    ['AuthenticationError', 'auth'],
    ['RateLimitError', 'rate_limit'],
    ['NotFoundError', 'invalid_model'],
    ['APIConnectionError', 'network'],
    ['APIError', 'provider'],
  ] as const)('maps Anthropic %s to code %s', async (errorClassName, expectedCode) => {
    const { adapter, instance } = newAdapter();
    const ErrorClass = (Anthropic as unknown as Record<string, new (message: string) => Error>)[errorClassName];
    instance.messages.stream.mockReturnValue(fakeErrorStream(new ErrorClass('boom')));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toEqual([{ type: 'error', code: expectedCode, message: 'boom' }]);
  });

  it('maps an aborted signal to code aborted regardless of the thrown error', async () => {
    const { adapter, instance } = newAdapter();
    instance.messages.stream.mockReturnValue(fakeErrorStream(new Error('stream closed')));
    const controller = new AbortController();
    controller.abort();

    const events = await collect(adapter.chat(buildRequest({ signal: controller.signal })));

    expect(events).toEqual([{ type: 'error', code: 'aborted', message: 'stream closed' }]);
  });
});

describe('AnthropicAdapter.listModels', () => {
  it('maps Anthropic model fields to AgentModelInfo', async () => {
    const { adapter, instance } = newAdapter();
    instance.models.list.mockReturnValue([
      { id: 'claude-opus-5', display_name: 'Claude Opus 5', max_input_tokens: 1_000_000, max_tokens: 128_000 },
      { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', max_input_tokens: 200_000, max_tokens: 8192 },
    ]);

    const models = await adapter.listModels();

    expect(models).toEqual([
      { id: 'claude-opus-5', label: 'Claude Opus 5', contextWindow: 1_000_000, maxOutputTokens: 128_000, supportsTools: true, isFree: false },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', contextWindow: 200_000, maxOutputTokens: 8192, supportsTools: true, isFree: false },
    ]);
  });

  it('wraps a listModels failure in a ProviderError with a classified code', async () => {
    const { adapter, instance } = newAdapter();
    const NetworkError = (Anthropic as unknown as { APIConnectionError: new (message: string) => Error }).APIConnectionError;
    instance.models.list.mockImplementation(() => {
      throw new NetworkError('down');
    });

    await expect(adapter.listModels()).rejects.toMatchObject({ code: 'network' });
  });
});

describe('AnthropicAdapter.validateModel', () => {
  it('returns valid when retrieve resolves', async () => {
    const { adapter, instance } = newAdapter();
    instance.models.retrieve.mockResolvedValue({ id: 'claude-opus-5' });

    await expect(adapter.validateModel('claude-opus-5')).resolves.toBe('valid');
  });

  it('returns not-found on Anthropic.NotFoundError', async () => {
    const { adapter, instance } = newAdapter();
    const NotFoundError = (Anthropic as unknown as { NotFoundError: new (message: string) => Error }).NotFoundError;
    instance.models.retrieve.mockRejectedValue(new NotFoundError('nope'));

    await expect(adapter.validateModel('bogus')).resolves.toBe('not-found');
  });

  it('returns unknown on any other error', async () => {
    const { adapter, instance } = newAdapter();
    instance.models.retrieve.mockRejectedValue(new Error('weird'));

    await expect(adapter.validateModel('claude-opus-5')).resolves.toBe('unknown');
  });
});
