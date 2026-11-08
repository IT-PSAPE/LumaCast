import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationAudioInputTransport } from '../../../../apps/stream/renderer/application-audio-input';

function setup() {
  const node = Object.assign(new EventTarget(), { port: { onmessage: null as any, onmessageerror: null as any, start: vi.fn(), close: vi.fn(), postMessage: vi.fn() } });
  return { node, input: new ApplicationAudioInputTransport(node as any), consume: (sequence: number) => node.port.onmessage({ data: { type: 'consumed', sequence } }) };
}
describe('application audio input receipts', () => {
  afterEach(() => vi.useRealTimers());
  it('reports ready+idle processor failure once and normal close removes its failure owner', async () => {
    const { input, node } = setup();
    node.port.onmessage({ data: { type: 'ready' } });
    await input.waitUntilReady();
    const failure = vi.fn(); input.onError(failure);
    node.dispatchEvent(new Event('processorerror'));
    node.dispatchEvent(new Event('processorerror'));
    expect(failure).toHaveBeenCalledOnce();
    expect(failure.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    const closed = setup(); const obsolete = vi.fn();
    closed.input.onError(obsolete); closed.input.close();
    closed.node.dispatchEvent(new Event('processorerror'));
    expect(obsolete).not.toHaveBeenCalled();
  });
  it('waits for actual processor activity and rejects close, failure and readiness timeout', async () => {
    vi.useFakeTimers();
    const { input, node } = setup();
    const ready = input.waitUntilReady();
    let settled = false;
    void ready.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    node.port.onmessage({ data: { type: 'ready' } });
    await expect(ready).resolves.toBe(true);
    input.close();
    const cancelled = setup();
    const cancellation = expect(cancelled.input.waitUntilReady()).rejects.toThrow(/closed before readiness/);
    cancelled.input.close(); await cancellation;
    const failed = setup();
    const failure = expect(failed.input.waitUntilReady()).rejects.toThrow(/processor failed/);
    failed.node.dispatchEvent(new Event('processorerror')); await failure;
    const stalled = setup();
    const timeout = expect(stalled.input.waitUntilReady()).rejects.toThrow(/did not become ready/);
    await vi.advanceTimersByTimeAsync(2000); await timeout;
  });
  it('resolves only matching FIFO consumed receipts', async () => {
    const { input, node, consume } = setup();
    const first = vi.fn();
    const pending = input.push(new ArrayBuffer(8)).then(first);
    await Promise.resolve(); expect(first).not.toHaveBeenCalled();
    expect(node.port.postMessage.mock.calls[0]?.[0]).toMatchObject({ type: 'pcm', sequence: 1 });
    consume(1); await pending; expect(first).toHaveBeenCalledWith(true);
    input.close();
  });
  it('settles cancellation without credit and rejects a sixth pending packet', async () => {
    const { input } = setup();
    const first = input.push(new ArrayBuffer(8)); input.close();
    await expect(first).resolves.toBe(false);
    const next = setup();
    const pending = Array.from({ length: 5 }, () => next.input.push(new ArrayBuffer(7680)));
    const assertions = pending.map((value) => expect(value).rejects.toThrow(/window/));
    await expect(next.input.push(new ArrayBuffer(8))).rejects.toThrow(/window/);
    await Promise.all(assertions);
  });
  it('rejects receipts on processor and synchronous transfer errors', async () => {
    const { input, node } = setup();
    const pending = input.push(new ArrayBuffer(8));
    const assertion = expect(pending).rejects.toThrow(/processor failed/);
    node.dispatchEvent(new Event('processorerror')); await assertion;
    const next = setup(); next.node.port.postMessage.mockImplementation(() => { throw new Error('closed'); });
    await expect(next.input.push(new ArrayBuffer(8))).rejects.toThrow(/could not receive/);
  });
});
