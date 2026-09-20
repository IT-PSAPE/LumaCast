// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { OpenAiCompatibleAdapter } from '../../../../../app/main/agent/providers/openai-compatible-adapter';
import { ProviderError } from '../../../../../app/main/agent/providers/types';
import type { ProviderChatRequest, ProviderStreamEvent } from '../../../../../app/main/agent/providers/types';

// ---------------------------------------------------------------------------
// Fake openai SDK. Every constructed instance is pushed onto the static
// `instances` array so tests can grab the freshly-created client and drive
// its `models.list` / `models.retrieve` / `chat.completions.create` mocks.
// ---------------------------------------------------------------------------
vi.mock('openai', () => {
  class FakeAPIError extends Error {
    status?: number;
    code?: string | number;
    constructor(message: string, opts?: { status?: number; code?: string | number }) {
      super(message);
      this.name = 'APIError';
      if (opts?.status !== undefined) this.status = opts.status;
      if (opts?.code !== undefined) this.code = opts.code;
    }
  }
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

    options: unknown;
    models = { list: vi.fn(), retrieve: vi.fn() };
    chat = { completions: { create: vi.fn() } };

    constructor(options: unknown) {
      this.options = options;
      FakeOpenAI.instances.push(this);
    }
  }

  return { default: FakeOpenAI };
});

function latestInstance(): {
  options: { apiKey: string; baseURL: string | undefined; maxRetries: number; timeout: number; defaultHeaders?: Record<string, string> };
  models: { list: ReturnType<typeof vi.fn>; retrieve: ReturnType<typeof vi.fn> };
  chat: { completions: { create: ReturnType<typeof vi.fn> } };
} {
  return (OpenAI as unknown as { instances: unknown[] }).instances.at(-1) as never;
}

function fakeStream(chunks: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function textChunk(content: string) {
  return { choices: [{ index: 0, delta: { content }, finish_reason: null }] };
}

function toolCallStartChunk(index: number, id: string, name: string) {
  return { choices: [{ index: 0, delta: { tool_calls: [{ index, id, type: 'function', function: { name, arguments: '' } }] }, finish_reason: null }] };
}

function toolCallArgsChunk(index: number, argumentsFragment: string) {
  return { choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: argumentsFragment } }] }, finish_reason: null }] };
}

function finishChunk(finishReason: string | null) {
  return { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] };
}

function usageChunk(promptTokens: number, completionTokens: number) {
  return { choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } };
}

function buildRequest(overrides: Partial<ProviderChatRequest> = {}): ProviderChatRequest {
  return {
    model: 'gpt-5',
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

function newAdapter(provider: 'openai' | 'google' | 'openrouter' | 'openai-compatible' = 'openai', baseUrl: string | null = null, deps?: Partial<{ streamIdleTimeoutMs: number }>) {
  const adapter = new OpenAiCompatibleAdapter(provider, { apiKey: 'test-key', baseUrl }, deps);
  return { adapter, instance: latestInstance() };
}

describe('OpenAiCompatibleAdapter construction', () => {
  it('uses the SDK default base URL for openai', () => {
    const { instance } = newAdapter('openai');
    expect(instance.options.baseURL).toBeUndefined();
  });

  it('uses the fixed Google OpenAI-compatible base URL', () => {
    const { instance } = newAdapter('google');
    expect(instance.options.baseURL).toBe('https://generativelanguage.googleapis.com/v1beta/openai/');
  });

  it('uses the fixed OpenRouter base URL and attribution headers', () => {
    const { instance } = newAdapter('openrouter');
    expect(instance.options.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(instance.options.defaultHeaders).toEqual({
      'HTTP-Referer': 'https://github.com/IT-PSAPE/LumaCast',
      'X-OpenRouter-Title': 'LumaCast',
      'X-Title': 'LumaCast',
    });
  });

  it('uses the provided base URL for openai-compatible', () => {
    const { instance } = newAdapter('openai-compatible', 'https://my-endpoint.example.com/v1');
    expect(instance.options.baseURL).toBe('https://my-endpoint.example.com/v1');
  });

  it('throws a ProviderError when openai-compatible has no base URL', () => {
    expect(() => new OpenAiCompatibleAdapter('openai-compatible', { apiKey: 'key', baseUrl: null })).toThrow(ProviderError);
    try {
      new OpenAiCompatibleAdapter('openai-compatible', { apiKey: 'key', baseUrl: null });
      throw new Error('expected constructor to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe('provider');
    }
  });
});

describe('OpenAiCompatibleAdapter request shape mapping', () => {
  it('maps system, tools, and every message kind to the OpenAI wire format', async () => {
    const { adapter, instance } = newAdapter('openai');
    instance.chat.completions.create.mockResolvedValue(fakeStream([finishChunk('stop')]));

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

    expect(instance.chat.completions.create).toHaveBeenCalledTimes(1);
    const [params, options] = instance.chat.completions.create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];

    expect(params.model).toBe(request.model);
    expect(params.stream).toBe(true);
    expect(params.stream_options).toEqual({ include_usage: true });
    expect(params.max_tokens).toBe(2048);
    expect(params.tool_choice).toBe('auto');
    expect(params.tools).toEqual([{ type: 'function', function: { name: 'search', description: 'Searches things', parameters: { type: 'object', properties: {} } } }]);
    expect(params.messages).toEqual([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'Let me check.',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"weather"}' } }],
      },
      // tool_results fan out into one `tool` message PER result — never combined.
      { role: 'tool', tool_call_id: 'call_1', content: 'sunny' },
      { role: 'tool', tool_call_id: 'call_2', content: 'oops' },
    ]);
    // Since the idle-watchdog work (0288150), the signal handed to the SDK
    // is `withIdleTimeout`'s own derived controller, not `request.signal`
    // itself — it forwards `request.signal`'s abort (covered by the "stream
    // idle watchdog" tests below) but is never the same object, so this only
    // checks that a fresh, not-yet-aborted signal was passed.
    expect(Object.keys(options)).toEqual(['signal']);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect((options.signal as AbortSignal).aborted).toBe(false);
  });

  it('omits tools/tool_choice entirely when no tools are configured', async () => {
    const { adapter, instance } = newAdapter('openai');
    instance.chat.completions.create.mockResolvedValue(fakeStream([finishChunk('stop')]));

    await collect(adapter.chat(buildRequest({ tools: [] })));

    const [params] = instance.chat.completions.create.mock.calls[0] as [Record<string, unknown>];
    expect(params.tools).toBeUndefined();
    expect(params.tool_choice).toBeUndefined();
  });

  it('sends assistant content as null (not empty string) when a turn is tool-calls-only', async () => {
    const { adapter, instance } = newAdapter('openai');
    instance.chat.completions.create.mockResolvedValue(fakeStream([finishChunk('stop')]));

    await collect(
      adapter.chat(
        buildRequest({
          messages: [
            {
              role: 'assistant',
              parts: [{ type: 'tool_call', id: 'call_1', name: 'search', arguments: {}, rawArguments: '{}', parseError: null }],
            },
          ],
        }),
      ),
    );

    const [params] = instance.chat.completions.create.mock.calls[0] as [Record<string, unknown>];
    const messages = params.messages as Record<string, unknown>[];
    expect(messages[1].content).toBeNull();
  });
});

describe('OpenAiCompatibleAdapter text streaming', () => {
  it('emits a text_delta event per streamed fragment', async () => {
    const { adapter, instance } = newAdapter('openai');
    instance.chat.completions.create.mockResolvedValue(fakeStream([textChunk('Hello'), textChunk(', world'), finishChunk('stop')]));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events.filter((event) => event.type === 'text_delta')).toEqual([
      { type: 'text_delta', text: 'Hello' },
      { type: 'text_delta', text: ', world' },
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end_turn', assistant: [{ type: 'text', text: 'Hello, world' }] });
  });
});

describe('OpenAiCompatibleAdapter tool call streaming', () => {
  it('streams a single tool call across fragments and parses the final arguments', async () => {
    const { adapter, instance } = newAdapter('openai');
    instance.chat.completions.create.mockResolvedValue(
      fakeStream([toolCallStartChunk(0, 'call_1', 'search'), toolCallArgsChunk(0, '{"q":'), toolCallArgsChunk(0, '"weather"}'), finishChunk('tool_calls')]),
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
    const { adapter, instance } = newAdapter('openai');
    instance.chat.completions.create.mockResolvedValue(
      fakeStream([
        toolCallStartChunk(0, 'call_1', 'search'),
        toolCallStartChunk(1, 'call_2', 'weather'),
        toolCallArgsChunk(0, '{"q":"a"}'),
        toolCallArgsChunk(1, '{"city":"b"}'),
        finishChunk('tool_calls'),
      ]),
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
    const { adapter, instance } = newAdapter('openai');
    instance.chat.completions.create.mockResolvedValue(
      fakeStream([toolCallStartChunk(0, 'call_1', 'search'), toolCallArgsChunk(0, '{"q": not-json'), finishChunk('tool_calls')]),
    );

    const events = await collect(adapter.chat(buildRequest()));

    const toolCallEnd = events.find((event) => event.type === 'tool_call_end') as { arguments: unknown; parseError: string | null };
    expect(toolCallEnd.arguments).toBeNull();
    expect(toolCallEnd.parseError).toEqual(expect.any(String));
  });
});

describe('OpenAiCompatibleAdapter usage', () => {
  it('emits a usage event from the final usage-bearing chunk', async () => {
    const { adapter, instance } = newAdapter('openai');
    instance.chat.completions.create.mockResolvedValue(fakeStream([textChunk('hi'), finishChunk('stop'), usageChunk(12, 34)]));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toContainEqual({ type: 'usage', inputTokens: 12, outputTokens: 34 });
  });
});

describe('OpenAiCompatibleAdapter finish_reason mapping', () => {
  it.each([
    ['stop', 'end_turn'],
    ['tool_calls', 'tool_use'],
    ['length', 'max_tokens'],
    ['content_filter', 'refusal'],
    ['function_call', 'other'],
    ['MALFORMED_FUNCTION_CALL', 'other'],
  ] as const)('maps finish_reason %s to %s', async (finishReason, expected) => {
    const { adapter, instance } = newAdapter('openai');
    instance.chat.completions.create.mockResolvedValue(fakeStream([finishChunk(finishReason)]));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: expected });
  });
});

describe('OpenAiCompatibleAdapter error mapping', () => {
  it.each([
    ['AuthenticationError', 'auth'],
    ['RateLimitError', 'rate_limit'],
    ['NotFoundError', 'invalid_model'],
    ['APIConnectionError', 'network'],
    ['APIError', 'provider'],
  ] as const)('maps OpenAI %s to code %s', async (errorClassName, expectedCode) => {
    const { adapter, instance } = newAdapter('openai');
    const ErrorClass = (OpenAI as unknown as Record<string, new (message: string) => Error>)[errorClassName];
    instance.chat.completions.create.mockRejectedValue(new ErrorClass('boom'));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toEqual([{ type: 'error', code: expectedCode, message: 'boom' }]);
  });

  it('maps an aborted signal to code aborted regardless of the thrown error', async () => {
    const { adapter, instance } = newAdapter('openai');
    const controller = new AbortController();
    // Abort from inside the mocked call (as a real cancel racing the SDK
    // would) rather than before `chat()` even starts: since 0288150, `chat`
    // checks its idle signal for an abort before calling `create` at all, so
    // a signal aborted up front never reaches `create`'s mocked rejection.
    instance.chat.completions.create.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error('stream closed'));
    });

    const events = await collect(adapter.chat(buildRequest({ signal: controller.signal })));

    expect(events).toEqual([{ type: 'error', code: 'aborted', message: 'stream closed' }]);
  });
});

describe('OpenAiCompatibleAdapter.listModels', () => {
  it('maps plain OpenAI model fields to AgentModelInfo, prettifying the id and inferring the vendor', async () => {
    const { adapter, instance } = newAdapter('openai');
    instance.models.list.mockReturnValue([{ id: 'gpt-5', created: 0, object: 'model', owned_by: 'openai' }]);

    const models = await adapter.listModels();

    expect(models).toEqual([{ id: 'gpt-5', label: 'GPT 5', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: 'openai' }]);
  });

  it('prettifies an OpenAI model id with no recognizable vendor family and still forces vendor openai', async () => {
    const { adapter, instance } = newAdapter('openai');
    instance.models.list.mockReturnValue([{ id: 'gpt-4o-mini', created: 0, object: 'model', owned_by: 'openai' }]);

    const models = await adapter.listModels();

    expect(models).toEqual([{ id: 'gpt-4o-mini', label: 'GPT 4o Mini', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: 'openai' }]);
  });

  it('reads OpenRouter context_length and supported_parameters', async () => {
    const { adapter, instance } = newAdapter('openrouter');
    instance.models.list.mockReturnValue([
      { id: 'anthropic/claude-opus-5', context_length: 1_000_000, supported_parameters: ['tools', 'temperature'] },
      { id: 'some/no-tools-model', context_length: 32_000, supported_parameters: ['temperature'] },
      { id: 'some/undeclared-model' },
    ]);

    const models = await adapter.listModels();

    expect(models).toEqual([
      { id: 'anthropic/claude-opus-5', label: 'Claude Opus 5', contextWindow: 1_000_000, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: 'anthropic' },
      { id: 'some/no-tools-model', label: 'No Tools Model', contextWindow: 32_000, maxOutputTokens: null, supportsTools: false, isFree: false, vendor: null },
      { id: 'some/undeclared-model', label: 'Undeclared Model', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: null },
    ]);
  });

  it('reads OpenRouter name and pricing to build the label, isFree, and vendor', async () => {
    const { adapter, instance } = newAdapter('openrouter');
    instance.models.list.mockReturnValue([
      { id: 'anthropic/claude-sonnet-4', name: 'Anthropic: Claude Sonnet 4', pricing: { prompt: '0.000003', completion: '0.000015' } },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (free)', pricing: { prompt: '0', completion: '0' } },
      { id: 'x-ai/grok-4', name: 'xAI: Grok 4', pricing: { prompt: '0.000002', completion: '0.00001' } },
      { id: 'qwen/qwen3-coder', name: 'Qwen: Qwen3 Coder', pricing: { prompt: '0.000001', completion: '0.000004' } },
      { id: 'mistralai/mistral-large', name: 'Mistral AI: Mistral Large', pricing: { prompt: '0.000002', completion: '0.000006' } },
      { id: 'deepseek/deepseek-v3', name: 'DeepSeek: DeepSeek V3', pricing: { prompt: '0.0000003', completion: '0.0000009' } },
      { id: 'some-unknown-vendor/mystery-model', name: 'Mystery Vendor: Mystery Model', pricing: { prompt: '0.000001', completion: '0.000002' } },
    ]);

    const models = await adapter.listModels();

    expect(models).toEqual([
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: 'anthropic' },
      {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        label: 'Llama 3.3 70B Instruct',
        contextWindow: null,
        maxOutputTokens: null,
        supportsTools: true,
        isFree: true,
        vendor: 'meta',
      },
      { id: 'x-ai/grok-4', label: 'Grok 4', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: 'xai' },
      { id: 'qwen/qwen3-coder', label: 'Qwen3 Coder', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: 'qwen' },
      { id: 'mistralai/mistral-large', label: 'Mistral Large', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: 'mistral' },
      { id: 'deepseek/deepseek-v3', label: 'DeepSeek V3', contextWindow: null, maxOutputTokens: null, supportsTools: true, isFree: false, vendor: 'deepseek' },
      {
        id: 'some-unknown-vendor/mystery-model',
        label: 'Mystery Model',
        contextWindow: null,
        maxOutputTokens: null,
        supportsTools: true,
        isFree: false,
        vendor: null,
      },
    ]);
  });

  it('treats a :free id suffix as free even when pricing is absent, and non-zero pricing as not free', async () => {
    const { adapter, instance } = newAdapter('openrouter');
    instance.models.list.mockReturnValue([
      { id: 'some/free-model:free' },
      { id: 'some/paid-model', pricing: { prompt: '0.000001', completion: '0' } },
    ]);

    const models = await adapter.listModels();

    expect(models.map((model) => ({ id: model.id, isFree: model.isFree }))).toEqual([
      { id: 'some/free-model:free', isFree: true },
      { id: 'some/paid-model', isFree: false },
    ]);
  });

  it('wraps a listModels failure in a ProviderError with a classified code', async () => {
    const { adapter, instance } = newAdapter('openai');
    const NetworkError = (OpenAI as unknown as { APIConnectionError: new (message: string) => Error }).APIConnectionError;
    instance.models.list.mockImplementation(() => {
      throw new NetworkError('down');
    });

    await expect(adapter.listModels()).rejects.toMatchObject({ code: 'network' });
  });
});

describe('OpenAiCompatibleAdapter.validateModel', () => {
  it('returns valid when retrieve resolves', async () => {
    const { adapter, instance } = newAdapter('openai');
    instance.models.retrieve.mockResolvedValue({ id: 'gpt-5' });

    await expect(adapter.validateModel('gpt-5')).resolves.toBe('valid');
  });

  it('returns not-found when retrieve and the catalog confirm absence', async () => {
    const { adapter, instance } = newAdapter('openai');
    const NotFoundError = (OpenAI as unknown as { NotFoundError: new (message: string) => Error }).NotFoundError;
    instance.models.retrieve.mockRejectedValue(new NotFoundError('nope'));
    instance.models.list.mockReturnValue([]);

    await expect(adapter.validateModel('bogus')).resolves.toBe('not-found');
  });

  it('falls back to listModels when retrieve is unsupported, and finds the model', async () => {
    const { adapter, instance } = newAdapter('google');
    instance.models.retrieve.mockRejectedValue(new Error('405 method not allowed'));
    instance.models.list.mockReturnValue([{ id: 'gemini-3-pro', created: 0, object: 'model', owned_by: 'google' }]);

    await expect(adapter.validateModel('gemini-3-pro')).resolves.toBe('valid');
  });

  it('falls back to listModels when retrieve is unsupported, and reports not-found when absent there too', async () => {
    const { adapter, instance } = newAdapter('google');
    instance.models.retrieve.mockRejectedValue(new Error('405 method not allowed'));
    instance.models.list.mockReturnValue([{ id: 'gemini-3-pro', created: 0, object: 'model', owned_by: 'google' }]);

    await expect(adapter.validateModel('gemini-3-flash')).resolves.toBe('not-found');
  });

  it('returns unknown when both retrieve and the listModels fallback fail', async () => {
    const { adapter, instance } = newAdapter('google');
    instance.models.retrieve.mockRejectedValue(new Error('boom'));
    instance.models.list.mockImplementation(() => {
      throw new Error('also boom');
    });

    await expect(adapter.validateModel('gemini-3-pro')).resolves.toBe('unknown');
  });

  it('falls back to listModels on NotFoundError and still reports not-found when absent', async () => {
    const { adapter, instance } = newAdapter('openai');
    const NotFoundError = (OpenAI as unknown as { NotFoundError: new (message: string) => Error }).NotFoundError;
    instance.models.retrieve.mockRejectedValue(new NotFoundError('nope'));
    instance.models.list.mockReturnValue([{ id: 'gpt-5', created: 0, object: 'model', owned_by: 'openai' }]);

    await expect(adapter.validateModel('gpt-6')).resolves.toBe('not-found');
  });

  it('returns unknown when listModels fails after a non-NotFound retrieve error', async () => {
    const { adapter, instance } = newAdapter('google');
    instance.models.retrieve.mockRejectedValue(new Error('500 internal'));
    instance.models.list.mockImplementation(() => {
      throw new Error('down');
    });

    await expect(adapter.validateModel('gemini-3-pro')).resolves.toBe('unknown');
  });
});

describe('OpenAiCompatibleAdapter OpenRouter validateModel', () => {
  it('skips retrieve and uses listModels directly for OpenRouter', async () => {
    const { adapter, instance } = newAdapter('openrouter');
    instance.models.list.mockReturnValue([
      { id: 'anthropic/claude-sonnet-4', name: 'Anthropic: Claude Sonnet 4' },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (free)' },
    ]);

    await expect(adapter.validateModel('anthropic/claude-sonnet-4')).resolves.toBe('valid');
    await expect(adapter.validateModel('meta-llama/llama-3.3-70b-instruct:free')).resolves.toBe('valid');
    await expect(adapter.validateModel('nonexistent/model')).resolves.toBe('not-found');
    expect(instance.models.retrieve).not.toHaveBeenCalled();
  });

  it('returns unknown when OpenRouter listModels fails', async () => {
    const { adapter, instance } = newAdapter('openrouter');
    instance.models.list.mockImplementation(() => {
      throw new Error('rate limited');
    });

    await expect(adapter.validateModel('anthropic/claude-sonnet-4')).resolves.toBe('unknown');
  });
});

describe('OpenAiCompatibleAdapter stream idle watchdog', () => {
  it('reports a network error when the stream produces no data within the idle window', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, instance } = newAdapter('openai', null, { streamIdleTimeoutMs: 50 });
      instance.chat.completions.create.mockImplementation((_params, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
      const pending = collect(adapter.chat(buildRequest()));
      await vi.advanceTimersByTimeAsync(50);
      const events = await pending;

      expect(events).toEqual([
        { type: 'error', code: 'network', message: expect.stringContaining('stalled') },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds a stalled response body even when the SDK ends silently on abort', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, instance } = newAdapter('openrouter', null, { streamIdleTimeoutMs: 50 });
      instance.chat.completions.create.mockImplementation((_params, { signal }) => ({
        [Symbol.asyncIterator]: async function* () {
          yield textChunk('partial');
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        },
      }));
      const pending = collect(adapter.chat(buildRequest()));
      await vi.advanceTimersByTimeAsync(50);
      expect(await pending).toEqual([
        { type: 'text_delta', text: 'partial' },
        { type: 'error', code: 'network', message: expect.stringContaining('stalled') },
      ]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('classifies a caller cancel as aborted even when the watchdog exists', async () => {
    const { adapter, instance } = newAdapter('openai', null, { streamIdleTimeoutMs: 60_000 });
    const controller = new AbortController();
    instance.chat.completions.create.mockImplementation(() => {
      controller.abort();
      return fakeStream([textChunk('hi')]);
    });

    const events = await collect(adapter.chat(buildRequest({ signal: controller.signal })));

    expect(events).toEqual([{ type: 'error', code: 'aborted', message: expect.any(String) }]);
  });

  it('resets the idle timer on each received chunk so a slow but active stream does not time out', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, instance } = newAdapter('openai', null, { streamIdleTimeoutMs: 100 });

      instance.chat.completions.create.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield textChunk('a');
          await new Promise((resolve) => setTimeout(resolve, 80));
          yield { choices: [{ delta: { reasoning: 'thinking' }, finish_reason: null }] };
          await new Promise((resolve) => setTimeout(resolve, 80));
          yield textChunk('b');
          yield finishChunk('stop');
        },
      });
      const pending = collect(adapter.chat(buildRequest()));
      await vi.advanceTimersByTimeAsync(160);
      const events = await pending;
      expect(vi.getTimerCount()).toBe(0);
      expect(events.filter((e) => e.type === 'text_delta')).toEqual([
        { type: 'text_delta', text: 'a' },
        { type: 'text_delta', text: 'b' },
      ]);
      expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'end_turn' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposes the idle timer in the finally block after a successful stream', async () => {
    const { adapter, instance } = newAdapter('openai', null, { streamIdleTimeoutMs: 60_000 });
    instance.chat.completions.create.mockResolvedValue(fakeStream([textChunk('ok'), finishChunk('stop')]));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events.at(-1)).toMatchObject({ type: 'done', stopReason: 'end_turn' });
  });
});

describe('OpenAiCompatibleAdapter stream edge cases', () => {
  it('reports an error when the stream ends without a finish_reason and no output was produced', async () => {
    const { adapter, instance } = newAdapter('openai');
    instance.chat.completions.create.mockResolvedValue(fakeStream([]));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toEqual([{ type: 'error', code: 'provider', message: 'Stream ended with no output' }]);
  });

  it('reports an error when the stream ends without a finish_reason but text was produced', async () => {
    const adapter = new OpenAiCompatibleAdapter('openai', { apiKey: 'test-key', baseUrl: null }, { streamIdleTimeoutMs: 60_000 });
    const inst = latestInstance();
    inst.chat.completions.create.mockResolvedValue(fakeStream([textChunk('partial')]));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toEqual([
      { type: 'text_delta', text: 'partial' },
      { type: 'error', code: 'provider', message: 'Stream ended without a finish reason' },
    ]);
  });

  it('classifies a bare APIError with status 429 as rate_limit', async () => {
    const { adapter, instance } = newAdapter('openai');
    const APIError = (OpenAI as unknown as { APIError: new (message: string, opts?: { status?: number; code?: string | number }) => Error }).APIError;
    instance.chat.completions.create.mockRejectedValue(new APIError('rate limited', { status: 429 }));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toEqual([{ type: 'error', code: 'rate_limit', message: 'rate limited' }]);
  });

  it('classifies a bare APIError with numeric code 429 as rate_limit', async () => {
    const { adapter, instance } = newAdapter('openai');
    const APIError = (OpenAI as unknown as { APIError: new (message: string, opts?: { status?: number; code?: string | number }) => Error }).APIError;
    instance.chat.completions.create.mockRejectedValue(new APIError('limit exceeded', { code: 429 }));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toEqual([{ type: 'error', code: 'rate_limit', message: 'limit exceeded' }]);
  });

  it('classifies a bare APIError with string code "429" as rate_limit', async () => {
    const { adapter, instance } = newAdapter('openai');
    const APIError = (OpenAI as unknown as { APIError: new (message: string, opts?: { status?: number; code?: string | number }) => Error }).APIError;
    instance.chat.completions.create.mockRejectedValue(new APIError('too many', { code: '429' }));

    const events = await collect(adapter.chat(buildRequest()));

    expect(events).toEqual([{ type: 'error', code: 'rate_limit', message: 'too many' }]);
  });

  it('requires a tool-capable OpenRouter route instead of silently dropping requested tools', async () => {
    const { adapter, instance } = newAdapter('openrouter');
    instance.models.list.mockReturnValue([
      { id: 'some/no-tools-model', supported_parameters: ['temperature'] },
    ]);
    await adapter.listModels();

    instance.chat.completions.create.mockResolvedValue(fakeStream([textChunk('hi'), finishChunk('stop')]));

    await collect(
      adapter.chat(
        buildRequest({
          model: 'some/no-tools-model',
          tools: [{ name: 'search', description: 'Searches', inputSchema: { type: 'object', properties: {} } }],
        }),
      ),
    );

    const [params] = instance.chat.completions.create.mock.calls[0] as [Record<string, unknown>];
    expect(params.tools).toHaveLength(1);
    expect(params.tool_choice).toBe('auto');
    expect(params.provider).toEqual({ require_parameters: true });
  });

  it('includes tools when the OpenRouter model supports them', async () => {
    const { adapter, instance } = newAdapter('openrouter');
    instance.models.list.mockReturnValue([
      { id: 'anthropic/claude-sonnet-4', supported_parameters: ['tools', 'temperature'] },
    ]);
    await adapter.listModels();

    instance.chat.completions.create.mockResolvedValue(fakeStream([finishChunk('stop')]));

    await collect(
      adapter.chat(
        buildRequest({
          model: 'anthropic/claude-sonnet-4',
          tools: [{ name: 'search', description: 'Searches', inputSchema: { type: 'object', properties: {} } }],
        }),
      ),
    );

    const [params] = instance.chat.completions.create.mock.calls[0] as [Record<string, unknown>];
    expect(params.tools).toEqual([{ type: 'function', function: { name: 'search', description: 'Searches', parameters: { type: 'object', properties: {} } } }]);
    expect(params.tool_choice).toBe('auto');
  });
});


describe('OpenRouter in-band errors', () => {
  it('preserves partial output and classifies a mid-stream rate limit', async () => {
    const { adapter, instance } = newAdapter('openrouter');
    instance.chat.completions.create.mockResolvedValue(fakeStream([
      textChunk('partial'), { error: { code: 429, message: 'Capacity exhausted' }, choices: [] },
    ]));
    expect(await collect(adapter.chat(buildRequest()))).toEqual([
      { type: 'text_delta', text: 'partial' },
      { type: 'error', code: 'rate_limit', message: 'Capacity exhausted' },
    ]);
  });

  it('reports cancellation when the SDK quietly closes an aborted stream', async () => {
    const { adapter, instance } = newAdapter('openrouter');
    const controller = new AbortController();
    instance.chat.completions.create.mockReturnValue({
      [Symbol.asyncIterator]: async function* () { controller.abort(); },
    });
    expect(await collect(adapter.chat(buildRequest({ signal: controller.signal })))).toEqual([
      { type: 'error', code: 'aborted', message: expect.any(String) },
    ]);
  });
});
