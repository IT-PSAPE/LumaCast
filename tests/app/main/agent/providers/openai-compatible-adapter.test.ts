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

function newAdapter(provider: 'openai' | 'google' | 'openrouter' | 'openai-compatible' = 'openai', baseUrl: string | null = null) {
  const adapter = new OpenAiCompatibleAdapter(provider, { apiKey: 'test-key', baseUrl });
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
    expect(options).toEqual({ signal: request.signal });
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
    [null, 'other'],
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
    instance.chat.completions.create.mockRejectedValue(new Error('stream closed'));
    const controller = new AbortController();
    controller.abort();

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

  it('returns not-found on OpenAI.NotFoundError', async () => {
    const { adapter, instance } = newAdapter('openai');
    const NotFoundError = (OpenAI as unknown as { NotFoundError: new (message: string) => Error }).NotFoundError;
    instance.models.retrieve.mockRejectedValue(new NotFoundError('nope'));

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
});
