import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type {
  AgentActionRequest,
  AgentActionResponse,
  AgentMessagePart,
  AgentProviderId,
  AgentThread,
  AgentThreadEvent,
} from '@lumacast/protocol';
import { matrixForTier } from '@lumacast/protocol';
import { AgentConfigStore } from '../../../../app/main/agent/agent-config-store';
import { AgentThreadStore } from '../../../../app/main/agent/thread-store';
import { AgentRuntime, MAX_ITERATIONS } from '../../../../app/main/agent/agent-runtime';
import { SessionGrants } from '../../../../app/main/agent/permission-policy';
import type { createProviderAdapter } from '../../../../app/main/agent/providers';
import type {
  AssistantPart,
  ProviderChatRequest,
  ProviderStreamEvent,
} from '../../../../app/main/agent/providers';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

type BrokerInput = Omit<AgentActionRequest, 'requestId'>;
type BrokerOptions = { signal?: AbortSignal; timeoutMs?: number };
type Responder = (input: BrokerInput, options: BrokerOptions) => AgentActionResponse | Promise<AgentActionResponse>;

const OVERVIEW_RESULT = { counts: { playlists: 1 } };

function succeeded(result: unknown): AgentActionResponse {
  return { requestId: 'fake', outcome: 'succeeded', result };
}

/**
 * Records everything the runtime asks for and answers from a script. The
 * system-prompt `project.getOverview` read goes through this too, so
 * `toolRequests` filters it out — every assertion below is about tool calls
 * the model made, not the orientation read the runtime always performs.
 */
class FakeBroker {
  readonly requests: BrokerInput[] = [];
  readonly batchEvents: { batchId: string; phase: 'begin' | 'end' }[] = [];
  responder: Responder = () => succeeded({ ok: true });
  private batchCounter = 0;

  async request(input: BrokerInput, options: BrokerOptions = {}): Promise<AgentActionResponse> {
    this.requests.push(input);
    if (input.actionId === 'project.getOverview') return succeeded(OVERVIEW_RESULT);
    const response = await this.responder(input, options);
    if (options.signal?.aborted) return { requestId: 'fake', outcome: 'cancelled' };
    return response;
  }

  beginBatch(): string {
    this.batchCounter += 1;
    const batchId = `batch-${this.batchCounter}`;
    this.batchEvents.push({ batchId, phase: 'begin' });
    return batchId;
  }

  endBatch(batchId: string): void {
    this.batchEvents.push({ batchId, phase: 'end' });
  }

  get toolRequests(): BrokerInput[] {
    return this.requests.filter((request) => request.actionId !== 'project.getOverview');
  }
}

interface AdapterHarness {
  factory: typeof createProviderAdapter;
  chats: ProviderChatRequest[];
  providers: AgentProviderId[];
}

function makeAdapter(script: (callIndex: number) => ProviderStreamEvent[]): AdapterHarness {
  const chats: ProviderChatRequest[] = [];
  const providers: AgentProviderId[] = [];
  const factory = ((provider: AgentProviderId) => {
    providers.push(provider);
    return {
      id: provider,
      listModels: async () => [],
      validateModel: async () => 'valid' as const,
      chat: (request: ProviderChatRequest) => {
        const index = chats.length;
        chats.push(request);
        const events = script(index);
        return (async function* () {
          for (const event of events) yield event;
        })();
      },
    };
  }) as unknown as typeof createProviderAdapter;
  return { factory, chats, providers };
}

function textDelta(text: string): ProviderStreamEvent {
  return { type: 'text_delta', text };
}

function toolCall(id: string, name: string, args: unknown): ProviderStreamEvent {
  return { type: 'tool_call_end', id, name, arguments: args, rawArguments: JSON.stringify(args), parseError: null };
}

function assistantToolTurn(id: string, name: string, args: unknown): AssistantPart[] {
  return [{ type: 'tool_call', id, name, arguments: args, rawArguments: JSON.stringify(args), parseError: null }];
}

function doneText(text: string): ProviderStreamEvent {
  return { type: 'done', stopReason: 'end_turn', assistant: [{ type: 'text', text }] };
}

function doneTools(assistant: AssistantPart[]): ProviderStreamEvent {
  return { type: 'done', stopReason: 'tool_use', assistant };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let userDataPath: string;
let configStore: AgentConfigStore;
let threadStore: AgentThreadStore;
let broker: FakeBroker;
let grants: SessionGrants;
let events: AgentThreadEvent[];
let storedKey: string | null;

beforeEach(() => {
  userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-'));
  configStore = new AgentConfigStore(userDataPath);
  threadStore = new AgentThreadStore(userDataPath);
  broker = new FakeBroker();
  grants = new SessionGrants();
  events = [];
  storedKey = 'sk-test-key';
  configStore.update({ provider: 'anthropic', model: 'claude-opus-4' });
});

afterEach(() => {
  fs.rmSync(userDataPath, { recursive: true, force: true });
});

function makeRuntime(script: (callIndex: number) => ProviderStreamEvent[]): {
  runtime: AgentRuntime;
  adapter: AdapterHarness;
} {
  const adapter = makeAdapter(script);
  const runtime = new AgentRuntime({
    configStore,
    credentialStore: { getKey: () => storedKey },
    threadStore,
    broker,
    grants,
    createAdapter: adapter.factory,
    emit: (event) => {
      events.push(event);
    },
  });
  return { runtime, adapter };
}

function newThread(overrides: { provider?: AgentProviderId | null; model?: string | null } = {}): AgentThread {
  return threadStore.create({ provider: overrides.provider ?? null, model: overrides.model ?? null });
}

/** Resolves when the run reports `run_finished`; the run is started but never awaited by `sendMessage`. */
async function waitForFinish(): Promise<Extract<AgentThreadEvent, { type: 'run_finished' }>> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const finished = events.find((event) => event.type === 'run_finished');
    if (finished) return finished;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`run never finished; saw: ${events.map((event) => event.type).join(', ')}`);
}

function toolParts(threadId: Id): Extract<AgentMessagePart, { type: 'tool_call' }>[] {
  const thread = threadStore.get(threadId);
  const assistant = thread?.messages.find((message) => message.role === 'assistant');
  return (assistant?.parts ?? []).filter(
    (part): part is Extract<AgentMessagePart, { type: 'tool_call' }> => part.type === 'tool_call',
  );
}

function errorEvents() {
  return events.filter((event) => event.type === 'run_error');
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

describe('preconditions', () => {
  it('reports agent-disabled when every risk class is denied', async () => {
    configStore.update({ inApp: { matrix: matrixForTier('off'), showSafetyInterlock: true } });
    const thread = newThread();
    const { runtime, adapter } = makeRuntime(() => []);

    await runtime.sendMessage({ threadId: thread.id, text: 'hi' });

    expect(errorEvents()).toEqual([
      expect.objectContaining({ type: 'run_error', code: 'agent-disabled', threadId: thread.id }),
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'run_finished', reason: 'error' });
    // No provider call, and nothing written to the thread.
    expect(adapter.chats).toHaveLength(0);
    expect(threadStore.get(thread.id)?.messages).toEqual([]);
  });

  it('reports not-configured when no provider or model is selected', async () => {
    configStore.update({ provider: null, model: null });
    const thread = newThread();
    const { runtime } = makeRuntime(() => []);

    await runtime.sendMessage({ threadId: thread.id, text: 'hi' });

    expect(errorEvents()[0]).toMatchObject({ code: 'not-configured' });
  });

  it('reports no-credential when the selected provider has no stored key', async () => {
    storedKey = null;
    const thread = newThread();
    const { runtime } = makeRuntime(() => []);

    await runtime.sendMessage({ threadId: thread.id, text: 'hi' });

    expect(errorEvents()[0]).toMatchObject({ code: 'no-credential' });
  });

  it('rejects sendMessage for an unknown thread', async () => {
    const { runtime } = makeRuntime(() => []);
    await expect(runtime.sendMessage({ threadId: 'nope' as Id, text: 'hi' })).rejects.toThrow(/Thread not found/);
  });

  it('rejects a second sendMessage while a run is in flight', async () => {
    const thread = newThread();
    const { runtime } = makeRuntime(() => [textDelta('one moment'), doneText('one moment')]);

    await runtime.sendMessage({ threadId: thread.id, text: 'first' });
    expect(runtime.isRunning(thread.id)).toBe(true);
    await expect(runtime.sendMessage({ threadId: thread.id, text: 'second' })).rejects.toThrow(/in progress/);

    await waitForFinish();
    expect(runtime.isRunning(thread.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Plain replies
// ---------------------------------------------------------------------------

describe('a text-only reply', () => {
  it('persists the user and assistant messages, the streamed text, and the usage', async () => {
    const thread = newThread();
    const { runtime } = makeRuntime(() => [
      textDelta('Hello '),
      textDelta('there.'),
      { type: 'usage', inputTokens: 120, outputTokens: 7 },
      doneText('Hello there.'),
    ]);

    await runtime.sendMessage({ threadId: thread.id, text: 'say hi' });
    const finished = await waitForFinish();

    expect(finished.reason).toBe('completed');
    const stored = threadStore.get(thread.id);
    expect(stored?.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(stored?.messages[0].parts).toEqual([{ type: 'text', text: 'say hi' }]);
    expect(stored?.messages[1].parts).toEqual([{ type: 'text', text: 'Hello there.' }]);
    expect(stored?.messages[1].usage).toEqual({ inputTokens: 120, outputTokens: 7 });

    expect(events.map((event) => event.type)).toEqual([
      'run_started',
      'text_delta',
      'text_delta',
      'message_completed',
      'run_finished',
    ]);
  });

  it('always emits message_completed before run_finished, even on a provider error', async () => {
    const thread = newThread();
    const { runtime } = makeRuntime(() => [
      textDelta('thinking'),
      { type: 'error', code: 'rate_limit', message: 'Slow down' },
    ]);

    await runtime.sendMessage({ threadId: thread.id, text: 'go' });
    const finished = await waitForFinish();

    expect(finished.reason).toBe('error');
    expect(errorEvents()[0]).toMatchObject({ code: 'rate_limit', message: 'Slow down' });
    const types = events.map((event) => event.type);
    expect(types.indexOf('message_completed')).toBeLessThan(types.indexOf('run_finished'));
    expect(threadStore.get(thread.id)?.messages[1].parts).toContainEqual({
      type: 'error',
      code: 'rate_limit',
      message: 'Slow down',
    });
  });

  it('uses the thread’s own provider/model override in preference to the config', async () => {
    const thread = newThread({ provider: 'openai', model: 'gpt-5-mini' });
    const { runtime, adapter } = makeRuntime(() => [doneText('ok')]);

    await runtime.sendMessage({ threadId: thread.id, text: 'hi' });
    await waitForFinish();

    expect(adapter.providers).toEqual(['openai']);
    expect(adapter.chats[0].model).toBe('gpt-5-mini');
  });

  it('builds a system prompt from the preamble, the user instructions, and the project overview', async () => {
    configStore.update({ instructions: 'Prefer lowercase titles.' });
    const thread = newThread();
    const { runtime, adapter } = makeRuntime(() => [doneText('ok')]);

    await runtime.sendMessage({ threadId: thread.id, text: 'hi' });
    await waitForFinish();

    const system = adapter.chats[0].system;
    expect(system).toContain('LumaCast');
    expect(system).toContain('Look before you act');
    expect(system).toContain('Prefer lowercase titles.');
    expect(system).toContain('"playlists":1');
    expect(broker.requests[0]).toMatchObject({ actionId: 'project.getOverview', decision: 'auto', batchId: null });
  });

  it('offers the action tools but withholds the snapshot, log, and clipboard actions', async () => {
    const thread = newThread();
    const { runtime, adapter } = makeRuntime(() => [doneText('ok')]);

    await runtime.sendMessage({ threadId: thread.id, text: 'hi' });
    await waitForFinish();

    const names = adapter.chats[0].tools.map((tool) => tool.name);
    expect(names).toContain('playlist_create');
    expect(names).toContain('slide_take');
    for (const withheld of [
      'project_getSnapshot',
      'logs_listSessions',
      'logs_readSession',
      'logs_getCurrentPath',
      'logs_getSystemMetrics',
      'clipboard_read',
      'clipboard_write',
    ]) {
      expect(names).not.toContain(withheld);
    }
  });
});

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

describe('an auto-approved tool call', () => {
  it('decodes the params, runs inside one batch, and feeds the result back for a final reply', async () => {
    const thread = newThread();
    const args = { name: 'Sunday AM' };
    const { runtime, adapter } = makeRuntime((call) =>
      call === 0
        ? [toolCall('call-1', 'playlist_create', args), doneTools(assistantToolTurn('call-1', 'playlist_create', args))]
        : [textDelta('Created it.'), doneText('Created it.')],
    );
    broker.responder = () => succeeded({ ok: true, changed: { playlists: { upserted: ['p1'], deleted: [] } } });

    await runtime.sendMessage({ threadId: thread.id, text: 'make a playlist' });
    const finished = await waitForFinish();

    expect(finished.reason).toBe('completed');
    expect(broker.toolRequests).toEqual([
      {
        principal: { kind: 'in-app', threadId: thread.id },
        actionId: 'playlist.create',
        params: { name: 'Sunday AM' },
        decision: 'auto',
        interlockEnabled: true,
        batchId: 'batch-1',
      },
    ]);
    // Exactly one batch, opened and closed around the whole turn.
    expect(broker.batchEvents).toEqual([
      { batchId: 'batch-1', phase: 'begin' },
      { batchId: 'batch-1', phase: 'end' },
    ]);

    const [part] = toolParts(thread.id);
    expect(part).toMatchObject({ actionId: 'playlist.create', status: 'succeeded', error: null });
    expect(part.startedAt).not.toBeNull();
    expect(part.finishedAt).not.toBeNull();

    // The result went back to the model as a tool_results turn.
    const second = adapter.chats[1];
    expect(second.messages.at(-1)).toMatchObject({
      role: 'tool_results',
      results: [{ toolCallId: 'call-1', isError: false }],
    });
    expect(threadStore.get(thread.id)?.messages[1].parts.at(-1)).toEqual({ type: 'text', text: 'Created it.' });
  });

  it('runs several calls in one turn sequentially, inside a single batch', async () => {
    const thread = newThread();
    const assistant: AssistantPart[] = [
      ...assistantToolTurn('call-1', 'playlist_create', { name: 'A' }),
      ...assistantToolTurn('call-2', 'playlist_create', { name: 'B' }),
    ];
    const { runtime } = makeRuntime((call) =>
      call === 0
        ? [
            toolCall('call-1', 'playlist_create', { name: 'A' }),
            toolCall('call-2', 'playlist_create', { name: 'B' }),
            doneTools(assistant),
          ]
        : [doneText('done')],
    );
    const order: string[] = [];
    broker.responder = async (input) => {
      order.push((input.params as { name: string }).name);
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(`${(input.params as { name: string }).name}:done`);
      return succeeded({ ok: true });
    };

    await runtime.sendMessage({ threadId: thread.id, text: 'two playlists' });
    await waitForFinish();

    expect(order).toEqual(['A', 'A:done', 'B', 'B:done']);
    expect(broker.batchEvents.filter((event) => event.phase === 'begin')).toHaveLength(1);
  });
});

describe('permission decisions', () => {
  it('passes an ask decision through to the broker', async () => {
    // The default tier is unrestricted; these decisions need a tier that asks for destructive actions.
    configStore.update({ inApp: { matrix: matrixForTier('content'), showSafetyInterlock: true } });
    const thread = newThread();
    const args = { id: 'p1' };
    const { runtime } = makeRuntime((call) =>
      call === 0
        ? [toolCall('call-1', 'playlist_delete', args), doneTools(assistantToolTurn('call-1', 'playlist_delete', args))]
        : [doneText('gone')],
    );

    await runtime.sendMessage({ threadId: thread.id, text: 'delete it' });
    await waitForFinish();

    expect(broker.toolRequests[0]).toMatchObject({ actionId: 'playlist.delete', decision: 'ask' });
  });

  it('refuses a denied risk class without ever asking the renderer', async () => {
    configStore.update({ inApp: { matrix: matrixForTier('read-only'), showSafetyInterlock: true } });
    const thread = newThread();
    const args = { name: 'Nope' };
    const { runtime, adapter } = makeRuntime((call) =>
      call === 0
        ? [toolCall('call-1', 'playlist_create', args), doneTools(assistantToolTurn('call-1', 'playlist_create', args))]
        : [doneText('I cannot.')],
    );

    await runtime.sendMessage({ threadId: thread.id, text: 'make one' });
    await waitForFinish();

    expect(broker.toolRequests).toEqual([]);
    const [part] = toolParts(thread.id);
    expect(part).toMatchObject({ status: 'denied', error: 'Denied by permission settings' });
    expect(adapter.chats[1].messages.at(-1)).toMatchObject({
      role: 'tool_results',
      results: [{ toolCallId: 'call-1', isError: true, content: '{"error":"Denied by permission settings"}' }],
    });
  });

  it('records an always-allow answer so the next identical call runs automatically', async () => {
    configStore.update({ inApp: { matrix: matrixForTier('content'), showSafetyInterlock: true } });
    const thread = newThread();
    const args = { id: 'p1' };
    const call = (index: number): ProviderStreamEvent[] =>
      index < 2
        ? [
            toolCall(`call-${index}`, 'playlist_delete', args),
            doneTools(assistantToolTurn(`call-${index}`, 'playlist_delete', args)),
          ]
        : [doneText('all gone')];
    const { runtime } = makeRuntime(call);
    broker.responder = () => ({ requestId: 'fake', outcome: 'succeeded', result: { ok: true }, alwaysAllow: 'destructive' });

    await runtime.sendMessage({ threadId: thread.id, text: 'delete both' });
    await waitForFinish();

    expect(broker.toolRequests.map((request) => request.decision)).toEqual(['ask', 'auto']);
    expect(grants.has('in-app', 'destructive')).toBe(true);
  });
});

describe('bad tool calls', () => {
  it('answers an unknown tool name with an error, without calling the broker', async () => {
    const thread = newThread();
    const { runtime } = makeRuntime((call) =>
      call === 0
        ? [toolCall('call-1', 'make_coffee', {}), doneTools(assistantToolTurn('call-1', 'make_coffee', {}))]
        : [doneText('sorry')],
    );

    await runtime.sendMessage({ threadId: thread.id, text: 'coffee' });
    await waitForFinish();

    expect(broker.toolRequests).toEqual([]);
    expect(toolParts(thread.id)[0]).toMatchObject({
      actionId: 'make_coffee',
      status: 'failed',
      error: 'Unknown tool: make_coffee',
    });
  });

  it('answers invalid params with an error, without calling the broker', async () => {
    const thread = newThread();
    const { runtime, adapter } = makeRuntime((call) =>
      call === 0
        ? [toolCall('call-1', 'playlist_create', {}), doneTools(assistantToolTurn('call-1', 'playlist_create', {}))]
        : [doneText('fixed')],
    );

    await runtime.sendMessage({ threadId: thread.id, text: 'make one' });
    await waitForFinish();

    expect(broker.toolRequests).toEqual([]);
    const [part] = toolParts(thread.id);
    expect(part.status).toBe('failed');
    expect(part.error).toMatch(/name/);
    // The model gets the decode message so it can correct itself next turn.
    expect(adapter.chats[1].messages.at(-1)).toMatchObject({ role: 'tool_results', results: [{ isError: true }] });
  });

  it('reports a failed action as a tool error and keeps the run going', async () => {
    const thread = newThread();
    const args = { name: 'X' };
    const { runtime } = makeRuntime((call) =>
      call === 0
        ? [toolCall('call-1', 'playlist_create', args), doneTools(assistantToolTurn('call-1', 'playlist_create', args))]
        : [doneText('that failed')],
    );
    broker.responder = () => ({ requestId: 'fake', outcome: 'failed', error: 'Disk is full' });

    await runtime.sendMessage({ threadId: thread.id, text: 'make one' });
    const finished = await waitForFinish();

    expect(finished.reason).toBe('completed');
    expect(toolParts(thread.id)[0]).toMatchObject({ status: 'failed', error: 'Disk is full' });
  });
});

describe('result size', () => {
  it('truncates a huge tool result before the model sees it, leaving the stored part intact', async () => {
    const thread = newThread();
    const { runtime, adapter } = makeRuntime((call) =>
      call === 0
        ? [toolCall('call-1', 'playlist_list', {}), doneTools(assistantToolTurn('call-1', 'playlist_list', {}))]
        : [doneText('long list')],
    );
    const huge = 'x'.repeat(400_000);
    broker.responder = () => succeeded({ blob: huge });

    await runtime.sendMessage({ threadId: thread.id, text: 'list' });
    await waitForFinish();

    const results = (adapter.chats[1].messages.at(-1) as { results: { content: string }[] }).results;
    expect(results[0].content.endsWith('[truncated]')).toBe(true);
    expect(results[0].content.length).toBeLessThan(huge.length);
    expect(results[0].content.length).toBe(100 * 1024 + '[truncated]'.length);
    expect((toolParts(thread.id)[0].result as { blob: string }).blob).toHaveLength(400_000);
  });
});

describe('stopping a run', () => {
  it('cancels the in-flight call, leaves the untouched ones cancelled, and finishes as stopped', async () => {
    const thread = newThread();
    const assistant: AssistantPart[] = [
      ...assistantToolTurn('call-1', 'playlist_create', { name: 'A' }),
      ...assistantToolTurn('call-2', 'playlist_create', { name: 'B' }),
    ];
    const { runtime } = makeRuntime(() => [
      textDelta('working'),
      toolCall('call-1', 'playlist_create', { name: 'A' }),
      toolCall('call-2', 'playlist_create', { name: 'B' }),
      doneTools(assistant),
    ]);
    broker.responder = () => {
      runtime.stopGeneration(thread.id);
      return succeeded({ ok: true });
    };

    await runtime.sendMessage({ threadId: thread.id, text: 'two' });
    const finished = await waitForFinish();

    expect(finished.reason).toBe('stopped');
    expect(broker.toolRequests).toHaveLength(1);
    expect(toolParts(thread.id).map((part) => part.status)).toEqual(['cancelled', 'cancelled']);
    expect(events.at(-2)?.type).toBe('message_completed');
    expect(runtime.isRunning(thread.id)).toBe(false);
  });

  it('is a no-op when nothing is running', () => {
    const thread = newThread();
    const { runtime } = makeRuntime(() => []);
    expect(() => runtime.stopGeneration(thread.id)).not.toThrow();
  });
});

describe('iteration ceiling', () => {
  it('stops after MAX_ITERATIONS assistant/tool round trips', async () => {
    const thread = newThread();
    const { runtime, adapter } = makeRuntime((call) => [
      toolCall(`call-${call}`, 'playlist_list', {}),
      doneTools(assistantToolTurn(`call-${call}`, 'playlist_list', {})),
    ]);
    broker.responder = () => succeeded([]);

    await runtime.sendMessage({ threadId: thread.id, text: 'loop forever' });
    const finished = await waitForFinish();

    expect(finished.reason).toBe('max_iterations');
    expect(adapter.chats).toHaveLength(MAX_ITERATIONS);
    expect(broker.toolRequests).toHaveLength(MAX_ITERATIONS);
    expect(broker.batchEvents.filter((event) => event.phase === 'end')).toHaveLength(MAX_ITERATIONS);
  }, 20_000);
});
