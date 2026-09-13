// @vitest-environment node
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_ACTION_EVENTS, type AgentActionRequest, type AgentPrincipal } from '@lumacast/protocol';
import { AGENT_ACTION_DEFAULT_TIMEOUT_MS, AgentActionBroker } from '../../../../app/main/agent/action-broker';

const principal: AgentPrincipal = { kind: 'in-app', threadId: 'thread-1' };

type SentMessage = { channel: string; payload: unknown };

function createFakeWindow() {
  const sent: SentMessage[] = [];
  let destroyed = false;
  const window = {
    isDestroyed: () => destroyed,
    webContents: {
      send: (channel: string, payload: unknown) => { sent.push({ channel, payload }); },
    },
  } as unknown as BrowserWindow;
  return {
    window,
    sent,
    destroy: () => { destroyed = true; },
    lastRequest(): AgentActionRequest {
      const entry = [...sent].reverse().find((message) => message.channel === AGENT_ACTION_EVENTS.request);
      if (!entry) throw new Error('no request was sent');
      return entry.payload as AgentActionRequest;
    },
  };
}

function baseInput(overrides: Partial<Omit<AgentActionRequest, 'requestId'>> = {}): Omit<AgentActionRequest, 'requestId'> {
  return {
    principal,
    actionId: 'playlist.create',
    params: { name: 'Sunday' },
    decision: 'auto',
    interlockEnabled: false,
    batchId: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AgentActionBroker.request', () => {
  it('sends the request with a minted id and resolves on the matching response', async () => {
    const fake = createFakeWindow();
    const broker = new AgentActionBroker(() => fake.window);

    const pending = broker.request(baseInput());
    const sent = fake.lastRequest();
    expect(sent.requestId).toEqual(expect.any(String));
    expect(sent).toMatchObject({ actionId: 'playlist.create', decision: 'auto', principal });
    expect(broker.pendingCount).toBe(1);

    broker.handleResponse({ requestId: sent.requestId, outcome: 'succeeded', result: { ok: true } });
    await expect(pending).resolves.toEqual({ requestId: sent.requestId, outcome: 'succeeded', result: { ok: true } });
    expect(broker.pendingCount).toBe(0);
  });

  it('mints a distinct id per request and settles only the one named', async () => {
    const fake = createFakeWindow();
    const broker = new AgentActionBroker(() => fake.window);

    const first = broker.request(baseInput());
    const firstId = fake.lastRequest().requestId;
    const second = broker.request(baseInput({ actionId: 'playlist.delete' }));
    const secondId = fake.lastRequest().requestId;
    expect(firstId).not.toBe(secondId);

    broker.handleResponse({ requestId: secondId, outcome: 'cancelled' });
    await expect(second).resolves.toEqual({ requestId: secondId, outcome: 'cancelled' });
    expect(broker.pendingCount).toBe(1);

    broker.handleResponse({ requestId: firstId, outcome: 'denied', reason: 'user' });
    await expect(first).resolves.toMatchObject({ outcome: 'denied' });
  });

  it('fails immediately when no window is available', async () => {
    const broker = new AgentActionBroker(() => null);
    await expect(broker.request(baseInput())).resolves.toMatchObject({
      outcome: 'failed',
      error: expect.stringContaining('No application window'),
    });
    expect(broker.pendingCount).toBe(0);
  });

  it('fails immediately when the window is destroyed', async () => {
    const fake = createFakeWindow();
    fake.destroy();
    const broker = new AgentActionBroker(() => fake.window);
    await expect(broker.request(baseInput())).resolves.toMatchObject({ outcome: 'failed' });
    expect(fake.sent).toEqual([]);
  });

  it('fails an auto request after the default timeout', async () => {
    vi.useFakeTimers();
    const fake = createFakeWindow();
    const broker = new AgentActionBroker(() => fake.window);

    const pending = broker.request(baseInput());
    await vi.advanceTimersByTimeAsync(AGENT_ACTION_DEFAULT_TIMEOUT_MS - 1);
    expect(broker.pendingCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({
      outcome: 'failed',
      error: expect.stringContaining('Timed out'),
    });
    expect(broker.pendingCount).toBe(0);
  });

  it('never times out an ask request, which is waiting on a person', async () => {
    vi.useFakeTimers();
    const fake = createFakeWindow();
    const broker = new AgentActionBroker(() => fake.window);

    const pending = broker.request(baseInput({ decision: 'ask' }));
    await vi.advanceTimersByTimeAsync(AGENT_ACTION_DEFAULT_TIMEOUT_MS * 10);
    expect(broker.pendingCount).toBe(1);

    broker.handleResponse({ requestId: fake.lastRequest().requestId, outcome: 'succeeded', result: null });
    await expect(pending).resolves.toMatchObject({ outcome: 'succeeded' });
  });

  it('honours an explicit timeout on an ask request', async () => {
    vi.useFakeTimers();
    const fake = createFakeWindow();
    const broker = new AgentActionBroker(() => fake.window);

    const pending = broker.request(baseInput({ decision: 'ask' }), { timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toMatchObject({ outcome: 'failed' });
  });

  it('cancels on abort and tells the renderer to drop the request', async () => {
    const fake = createFakeWindow();
    const broker = new AgentActionBroker(() => fake.window);
    const controller = new AbortController();

    const pending = broker.request(baseInput(), { signal: controller.signal });
    const requestId = fake.lastRequest().requestId;
    controller.abort();

    await expect(pending).resolves.toEqual({ requestId, outcome: 'cancelled' });
    expect(fake.sent).toContainEqual({ channel: AGENT_ACTION_EVENTS.cancelled, payload: { requestId } });
    expect(broker.pendingCount).toBe(0);
  });

  it('cancels without sending when the signal was already aborted', async () => {
    const fake = createFakeWindow();
    const broker = new AgentActionBroker(() => fake.window);

    await expect(broker.request(baseInput(), { signal: AbortSignal.abort() })).resolves.toMatchObject({
      outcome: 'cancelled',
    });
    expect(fake.sent).toEqual([]);
  });

  it('drops a late response for an already-settled request', async () => {
    const fake = createFakeWindow();
    const broker = new AgentActionBroker(() => fake.window);

    const pending = broker.request(baseInput());
    const requestId = fake.lastRequest().requestId;
    broker.handleResponse({ requestId, outcome: 'succeeded', result: 1 });
    await expect(pending).resolves.toMatchObject({ result: 1 });

    expect(() => broker.handleResponse({ requestId, outcome: 'succeeded', result: 2 })).not.toThrow();
    expect(() => broker.handleResponse({ requestId: 'never-sent', outcome: 'cancelled' })).not.toThrow();
  });

  it('fails every in-flight request when the window is abandoned', async () => {
    const fake = createFakeWindow();
    const broker = new AgentActionBroker(() => fake.window);

    const pending = broker.request(baseInput());
    broker.abandonAll('Window closed.');
    await expect(pending).resolves.toMatchObject({ outcome: 'failed', error: 'Window closed.' });
    expect(broker.pendingCount).toBe(0);
  });
});

describe('AgentActionBroker batches', () => {
  let fake: ReturnType<typeof createFakeWindow>;
  let broker: AgentActionBroker;

  beforeEach(() => {
    fake = createFakeWindow();
    broker = new AgentActionBroker(() => fake.window);
  });

  it('brackets a batch with begin and end on one id', () => {
    const batchId = broker.beginBatch(principal);
    broker.endBatch(batchId, principal);

    expect(fake.sent).toEqual([
      { channel: AGENT_ACTION_EVENTS.batch, payload: { batchId, phase: 'begin', principal } },
      { channel: AGENT_ACTION_EVENTS.batch, payload: { batchId, phase: 'end', principal } },
    ]);
  });

  it('mints a distinct id per batch', () => {
    expect(broker.beginBatch(principal)).not.toBe(broker.beginBatch(principal));
  });

  it('is a no-op when no window is available', () => {
    const windowless = new AgentActionBroker(() => null);
    const batchId = windowless.beginBatch(principal);
    expect(() => windowless.endBatch(batchId, principal)).not.toThrow();
  });
});
