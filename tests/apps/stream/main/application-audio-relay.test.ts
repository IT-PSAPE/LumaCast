import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationAudioRelay } from '../../../../apps/stream/main/application-audio-relay';
import { IPC_CHANNELS } from '../../../../apps/stream/main/ipc-channels';

class Port extends EventTarget {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  start = vi.fn();
  close = vi.fn(() => this.dispatchEvent(new Event('close')));
  message(data: unknown) { this.onmessage?.({ data }); }
}
function setup() {
  const ipc = Object.assign(new EventEmitter(), { invoke: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined) });
  let epoch = 0;
  const relay = new ApplicationAudioRelay(ipc as any, () => `epoch-${++epoch}`);
  const announce = (port: Port, identity = { sourceId: 'source', epoch: `epoch-${epoch}` }) => ipc.emit(IPC_CHANNELS.applicationAudioFrame, { ports: [port] }, identity);
  return { ipc, relay, announce };
}
const turn = async () => { for (let i = 0; i < 5; ++i) await Promise.resolve(); };
describe('preload application audio ownership', () => {
  it('waits for consumption before acknowledging and keeps the existing public start signature', async () => {
    const { ipc, relay, announce } = setup();
    let consume!: (value: boolean) => void;
    const listener = vi.fn(() => new Promise<boolean>((resolve) => { consume = resolve; }));
    relay.subscribe(listener);
    await relay.start('start', 'source', [42, '/app']);
    expect(ipc.invoke).toHaveBeenCalledWith('start', 'source', 42, '/app', 'epoch-1');
    const port = new Port(); announce(port);
    port.message({ type: 'pcm', sequence: 1, buffer: new ArrayBuffer(8) });
    await turn();
    expect(port.postMessage).not.toHaveBeenCalled();
    consume(true); await turn();
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'consumed', sequence: 1 });
  });
  it('rejects late announcements and cannot acknowledge or fail a successor', async () => {
    const { relay, announce } = setup();
    let consume!: (value: boolean) => void;
    const listener = vi.fn(() => new Promise<boolean>((resolve) => { consume = resolve; }));
    relay.subscribe(listener);
    await relay.start('start', 'source', []);
    const old = new Port(); announce(old);
    old.message({ type: 'pcm', sequence: 1, buffer: new ArrayBuffer(8) }); await turn();
    await relay.stop('source');
    await relay.start('start', 'source', []);
    const current = new Port(); announce(current);
    const late = new Port(); announce(late, { sourceId: 'source', epoch: 'epoch-1' });
    old.message({ type: 'error', error: 'old error' });
    consume(true); await turn();
    expect(late.close).toHaveBeenCalledOnce();
    expect(current.close).not.toHaveBeenCalled();
    expect(old.postMessage).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledOnce();
  });
  it('synchronously tombstones a pending start before its old port arrives', async () => {
    const { ipc, relay, announce } = setup();
    relay.subscribe(async () => true);
    let finish!: () => void;
    ipc.invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const starting = relay.start('start', 'source', []);
    await relay.stop('source');
    await relay.start('start', 'source', []);
    const next = new Port(); announce(next);
    finish(); await starting;
    const old = new Port(); announce(old, { sourceId: 'source', epoch: 'epoch-1' });
    expect(old.close).toHaveBeenCalledOnce();
    expect(next.close).not.toHaveBeenCalled();
  });
  it.each(['reject', 'throw'])('reports %s consumer failure once and retains terminal error delivery', async (mode) => {
    const { relay, announce } = setup();
    const listener = vi.fn((): Promise<boolean> => {
      if (mode === 'throw') throw new Error('worklet failed');
      return Promise.reject(new Error('worklet failed'));
    });
    relay.subscribe(listener);
    await relay.start('start', 'source', []);
    const port = new Port(); announce(port);
    port.message({ type: 'pcm', sequence: 1, buffer: new ArrayBuffer(8) }); await turn();
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'failed' });
    port.message({ type: 'pcm', sequence: 2, buffer: new ArrayBuffer(8) }); await turn();
    expect(listener).toHaveBeenCalledOnce();
    port.message({ type: 'error', error: 'Restart the audio source.' }); await turn();
    expect(listener).toHaveBeenLastCalledWith('source', { error: 'Restart the audio source.' });
    expect(port.close).toHaveBeenCalledOnce();
  });
  it('an obsolete subscription cleanup cannot close the new subscription port', async () => {
    const { relay, announce } = setup();
    const unsubscribe = relay.subscribe(async () => true);
    relay.subscribe(async () => true);
    await relay.start('start', 'source', []);
    const port = new Port(); announce(port);
    unsubscribe();
    expect(port.close).not.toHaveBeenCalled();
  });
});
