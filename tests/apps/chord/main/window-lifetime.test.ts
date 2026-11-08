import { describe, expect, it, vi } from 'vitest';
import { WindowLifetime, type RetirableExportSinks } from '../../../../apps/chord/main/window-lifetime';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function setup(retire = vi.fn(async () => {})) {
  const registries: RetirableExportSinks[] = [];
  const createSinks = vi.fn(() => {
    const registry = { open: vi.fn(), write: vi.fn(), close: vi.fn(), abort: vi.fn(), retire: registries.length === 0 ? retire : vi.fn(async () => {}) };
    registries.push(registry);
    return registry;
  });
  const sendCloseRequest = vi.fn();
  const replayClose = vi.fn();
  const onCloseSettled = vi.fn();
  const lifetime = new WindowLifetime({ createSinks, sendCloseRequest, replayClose, onCloseSettled });
  const close = () => { const event = { preventDefault: vi.fn() }; lifetime.nativeClose(event); return event; };
  return { lifetime, registries, createSinks, sendCloseRequest, replayClose, onCloseSettled, retire, close };
}

describe('Chord window/renderer export lifetime', () => {
  it('queues a cold close until explicit mounted-bridge readiness', async () => {
    const context = setup();
    expect(context.close().preventDefault).toHaveBeenCalledOnce();
    expect(context.sendCloseRequest).not.toHaveBeenCalled();
    expect(await context.lifetime.finishClose(true)).toBe(false);
    expect(context.retire).not.toHaveBeenCalled();
    await context.lifetime.rendererReady();
    expect(context.sendCloseRequest).toHaveBeenCalledOnce();
  });

  it('Cancel/Save completion leaves the registry live and accepts another native close', async () => {
    const context = setup();
    await context.lifetime.rendererReady();
    context.close();
    expect(await context.lifetime.finishClose(false)).toBe(false);
    expect(context.retire).not.toHaveBeenCalled();
    context.close();
    expect(context.sendCloseRequest).toHaveBeenCalledTimes(2);
  });

  it('coalesces an approved close and replays only after its exact registry drains', async () => {
    const draining = deferred<void>();
    const context = setup(vi.fn(() => draining.promise));
    await context.lifetime.rendererReady();
    context.close();
    const first = context.lifetime.finishClose(true);
    expect(context.lifetime.finishClose(true)).toBe(first);
    expect(context.retire).toHaveBeenCalledOnce();
    expect(context.replayClose).not.toHaveBeenCalled();
    draining.resolve();
    await flush();
    expect(context.replayClose).toHaveBeenCalledOnce();
    expect(context.close().preventDefault).not.toHaveBeenCalled();
    await context.lifetime.closed();
    expect(await first).toBe(true);
  });

  it('respects a final unload veto and restores exactly one fresh registry for retry', async () => {
    const context = setup();
    await context.lifetime.rendererReady();
    context.close();
    const first = context.lifetime.finishClose(true);
    await flush();
    context.lifetime.unloadPrevented();
    context.lifetime.unloadPrevented();
    expect(await first).toBe(false);
    expect(context.createSinks).toHaveBeenCalledTimes(2);
    expect(context.lifetime.sinks).toBe(context.registries[1]);
    const second = context.lifetime.finishClose(true);
    await flush();
    expect(context.replayClose).toHaveBeenCalledTimes(2);
    await context.lifetime.closed();
    expect(await second).toBe(true);
  });

  it('duplicate readiness during close drain cannot publish or orphan an intermediate registry', async () => {
    const draining = deferred<void>();
    const context = setup(vi.fn(() => draining.promise));
    await context.lifetime.rendererReady();
    context.close();
    const closing = context.lifetime.finishClose(true);
    expect(await context.lifetime.rendererReady()).toBe(true);
    expect(context.createSinks).toHaveBeenCalledOnce();
    draining.resolve();
    await flush();
    expect(await context.lifetime.rendererReady()).toBe(true);
    expect(context.createSinks).toHaveBeenCalledOnce();
    context.lifetime.unloadPrevented();
    expect(await closing).toBe(false);
    expect(context.createSinks).toHaveBeenCalledTimes(2);
    await context.lifetime.closed();
    for (const registry of context.registries) expect(registry.retire).toHaveBeenCalledOnce();
  });

  it('reports retire failure, retains its fenced owner, and retries only on a fresh close', async () => {
    const retire = vi.fn().mockRejectedValueOnce(new Error('cleanup')).mockResolvedValue(undefined);
    const context = setup(retire);
    await context.lifetime.rendererReady();
    context.close();
    await expect(context.lifetime.finishClose(true)).rejects.toThrow('cleanup');
    expect(context.replayClose).not.toHaveBeenCalled();
    expect(context.createSinks).toHaveBeenCalledOnce();
    expect(context.lifetime.sinks).toBe(context.registries[0]);
    context.close();
    const retry = context.lifetime.finishClose(true);
    await flush();
    expect(retire).toHaveBeenCalledTimes(2);
    await context.lifetime.closed();
    expect(await retry).toBe(true);
  });

  it('never replays an old approval into a reloaded successor', async () => {
    const draining = deferred<void>();
    const context = setup(vi.fn(() => draining.promise));
    await context.lifetime.rendererReady();
    context.close();
    const oldClose = context.lifetime.finishClose(true);
    const lost = context.lifetime.rendererLost();
    const ready = context.lifetime.rendererReady();
    expect(context.createSinks).toHaveBeenCalledOnce();
    draining.resolve();
    await lost;
    expect(await ready).toBe(true);
    expect(await oldClose).toBe(false);
    expect(context.replayClose).not.toHaveBeenCalled();
    expect(context.createSinks).toHaveBeenCalledTimes(2);
  });

  it('old readiness cannot publish after another renderer loss or window closure', async () => {
    const draining = deferred<void>();
    const context = setup(vi.fn(() => draining.promise));
    const lost = context.lifetime.rendererLost();
    const oldReady = context.lifetime.rendererReady();
    const lostAgain = context.lifetime.rendererLost();
    draining.resolve();
    await Promise.all([lost, lostAgain]);
    expect(await oldReady).toBe(false);
    expect(context.createSinks).toHaveBeenCalledOnce();
    await context.lifetime.closed();
    expect(await context.lifetime.rendererReady()).toBe(false);
  });

  it('process loss retires independently and a crashed renderer cannot strand native close', async () => {
    const context = setup();
    await context.lifetime.rendererReady();
    await context.lifetime.rendererLost(true);
    expect(context.retire).toHaveBeenCalledOnce();
    context.close();
    await flush();
    expect(context.replayClose).toHaveBeenCalledOnce();
    await context.lifetime.closed();
  });

  it('a fresh native close retries failed readiness drain for the mounted successor', async () => {
    const failed = deferred<void>();
    const retire = vi.fn().mockReturnValueOnce(failed.promise).mockResolvedValue(undefined);
    const context = setup(retire);
    const lost = context.lifetime.rendererLost();
    const ready = context.lifetime.rendererReady();
    const failure = expect(ready).rejects.toThrow('drain');
    const lostFailure = expect(lost).rejects.toThrow('drain');
    failed.reject(new Error('drain'));
    await Promise.all([failure, lostFailure]);
    expect(context.createSinks).toHaveBeenCalledOnce();
    context.close();
    expect(retire).toHaveBeenCalledOnce();
    expect(context.sendCloseRequest).toHaveBeenCalledOnce();
    // The mounted close action owns the one explicit readiness retry.
    await context.lifetime.rendererReady();
    await flush();
    expect(retire).toHaveBeenCalledTimes(2);
    expect(context.createSinks).toHaveBeenCalledTimes(2);
    expect(context.sendCloseRequest).toHaveBeenCalledTimes(2);
    await context.lifetime.finishClose(false);
  });
});
