// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { IpcMain, IpcMainEvent, WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceShutdown } from '../../../../apps/stream/main/workspace-shutdown';
import { IPC_CHANNELS } from '../../../../apps/stream/main/ipc-channels';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const ipc = new EventEmitter();
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, isCrashed: (): boolean => false, mainFrame: { url: 'app://trusted' }, send: vi.fn() });
  const drain = vi.fn().mockResolvedValue(undefined);
  const shutdown = new WorkspaceShutdown(ipc as unknown as IpcMain, () => contents as unknown as WebContents, (url) => url === 'app://trusted', drain, 100);
  const ack = (saved = true, id = contents.send.mock.calls[0]?.[1], sender = contents, frame = contents.mainFrame) => {
    ipc.emit(IPC_CHANNELS.projectFlushed, { sender, senderFrame: frame } as unknown as IpcMainEvent, id, saved);
  };
  return { ipc, contents, drain, shutdown, ack };
}
afterEach(() => vi.useRealTimers());

describe('Stream graceful workspace shutdown', () => {
  it('coalesces repeated close/quit requests and waits for renderer ACK plus accepted store writes', async () => {
    const f = fixture();
    const writes = deferred();
    f.drain.mockImplementationOnce(() => writes.promise);
    const first = f.shutdown.flush();
    expect(f.shutdown.flush()).toBe(first);
    expect(f.contents.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.flushProject, 1);
    expect(f.drain).not.toHaveBeenCalled();
    f.ack();
    await Promise.resolve();
    expect(f.drain).toHaveBeenCalledTimes(1);
    let done = false;
    void first.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    writes.resolve();
    await first;
    expect(f.ipc.listenerCount(IPC_CHANNELS.projectFlushed)).toBe(0);
    expect(f.contents.listenerCount('destroyed')).toBe(0);
    expect(f.contents.listenerCount('render-process-gone')).toBe(0);
  });

  it('rejects a failed final save, resumes edits, and allows the next close attempt', async () => {
    const f = fixture();
    const first = f.shutdown.flush();
    f.ack(false);
    await expect(first).rejects.toThrow('could not be saved');
    expect(f.drain).not.toHaveBeenCalled();
    expect(f.contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.flushProject, 1, false);
    const retry = f.shutdown.flush();
    f.ack(true, 2);
    await retry;
    expect(f.drain).toHaveBeenCalledTimes(1);
  });

  it('ignores stale request IDs and ACKs from another window, subframe, or URL', async () => {
    const f = fixture();
    const closing = f.shutdown.flush();
    f.ack(true, 0);
    f.ack(true, 1, {} as typeof f.contents);
    f.ack(true, 1, f.contents, { url: 'app://untrusted' });
    expect(f.drain).not.toHaveBeenCalled();
    f.contents.mainFrame.url = 'app://untrusted';
    f.ack();
    expect(f.drain).not.toHaveBeenCalled();
    f.contents.mainFrame.url = 'app://trusted';
    f.ack();
    await closing;
  });

  it('times out an unresponsive renderer without treating its revision as saved', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const closing = f.shutdown.flush();
    const rejected = expect(closing).rejects.toThrow('did not respond');
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(f.drain).not.toHaveBeenCalled();
    expect(f.contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.flushProject, 1, false);
    expect(f.ipc.listenerCount(IPC_CHANNELS.projectFlushed)).toBe(0);
  });

  it('drains accepted writes when the renderer is already gone or crashes during flush', async () => {
    const absentDrain = vi.fn().mockResolvedValue(undefined);
    const absent = new WorkspaceShutdown(new EventEmitter() as unknown as IpcMain, () => null, () => true, absentDrain);
    await absent.flush();
    expect(absentDrain).toHaveBeenCalledTimes(1);
    const f = fixture();
    const closing = f.shutdown.flush();
    f.contents.emit('render-process-gone');
    await closing;
    expect(f.drain).toHaveBeenCalledTimes(1);
    const crashed = fixture();
    crashed.contents.isCrashed = () => true;
    await crashed.shutdown.flush();
    expect(crashed.contents.send).not.toHaveBeenCalled();
    expect(crashed.drain).toHaveBeenCalledTimes(1);
  });

  it('resumes renderer editing when the accepted store drain fails', async () => {
    const f = fixture();
    f.drain.mockRejectedValueOnce(new Error('Store drain failed'));
    const closing = f.shutdown.flush();
    f.ack();
    await expect(closing).rejects.toThrow('Store drain failed');
    expect(f.contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.flushProject, 1, false);
    const retry = f.shutdown.flush();
    expect(f.contents.send).toHaveBeenLastCalledWith(IPC_CHANNELS.flushProject, 2);
    f.ack(true, 2);
    await retry;
  });
});
