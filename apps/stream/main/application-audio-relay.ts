import type { IpcRenderer } from 'electron';
import { APPLICATION_AUDIO_PACKET_BYTES, isApplicationAudioEpoch, type ApplicationAudioConsumer } from '../shared/application-audio-transport';
import { IPC_CHANNELS } from './ipc-channels';

interface Owner {
  sourceId: string;
  epoch: string;
  port?: MessagePort;
  sequence: number;
  failed: boolean;
  closed: boolean;
  listener: ApplicationAudioConsumer;
}

/** Preload owns epochs/ports; renderer receipts earn credit only after playback. */
export class ApplicationAudioRelay {
  private readonly owners = new Map<string, Owner>();
  private listener: ApplicationAudioConsumer | null = null;
  private unsubscribe: () => void = () => {};

  constructor(private readonly ipc: Pick<IpcRenderer, 'invoke' | 'on' | 'removeListener'>,
    private readonly epoch: () => string = () => crypto.randomUUID()) {}

  async start(channel: string, sourceId: string, args: unknown[]): Promise<void> {
    if (!this.listener) return Promise.reject(new Error('The application-audio consumer is unavailable.'));
    const previous = this.owners.get(sourceId);
    if (previous) this.close(previous);
    const owner: Owner = { sourceId, epoch: this.epoch(), sequence: 0, failed: false, closed: false, listener: this.listener };
    this.owners.set(sourceId, owner);
    try { await this.ipc.invoke(channel, sourceId, ...args, owner.epoch); }
    catch (error) {
      this.close(owner);
      throw error;
    }
  }

  stop(sourceId: string): Promise<void> {
    const owner = this.owners.get(sourceId);
    if (owner) this.close(owner);
    return this.ipc.invoke(IPC_CHANNELS.stopApplicationAudioCapture, sourceId);
  }

  subscribe(listener: ApplicationAudioConsumer): () => void {
    this.unsubscribe();
    this.listener = listener;
    const handler = (event: Electron.IpcRendererEvent, identity: { sourceId?: unknown; epoch?: unknown }) => {
      const port = event.ports[0];
      if (!port) return;
      const owner = typeof identity?.sourceId === 'string' ? this.owners.get(identity.sourceId) : undefined;
      if (!owner || !isApplicationAudioEpoch(identity?.epoch) || owner.epoch !== identity.epoch
        || owner.listener !== listener || owner.port || !this.current(owner)) { port.close(); return; }
      owner.port = port;
      port.onmessage = ({ data }) => {
        if (!this.current(owner)) return;
        if (data?.type === 'error' && typeof data.error === 'string') {
          this.close(owner);
          this.notify(owner, data.error);
          return;
        }
        if (owner.failed) return;
        if (data?.type !== 'pcm' || !Number.isSafeInteger(data.sequence) || data.sequence !== owner.sequence + 1
          || !(data.buffer instanceof ArrayBuffer) || data.buffer.byteLength === 0
          || data.buffer.byteLength > APPLICATION_AUDIO_PACKET_BYTES || data.buffer.byteLength % 8) {
          this.fail(owner); return;
        }
        owner.sequence = data.sequence;
        const sequence = data.sequence as number;
        void Promise.resolve().then(() => {
          if (!this.current(owner)) return false;
          return listener(owner.sourceId, data.buffer);
        }).then((consumed) => {
          if (!this.current(owner) || owner.failed) return;
          if (consumed !== true) { this.close(owner); return; }
          owner.port!.postMessage({ type: 'consumed', sequence });
        }).catch(() => this.fail(owner));
      };
      port.onmessageerror = () => this.fail(owner);
      port.addEventListener('close', () => {
        if (!this.current(owner)) return;
        this.close(owner);
        this.notify(owner, 'Application audio capture connection closed.');
      }, { once: true });
      port.start();
    };
    this.ipc.on(IPC_CHANNELS.applicationAudioFrame, handler);
    let subscribed = true;
    const unsubscribe = () => {
      if (!subscribed) return;
      subscribed = false;
      this.ipc.removeListener(IPC_CHANNELS.applicationAudioFrame, handler);
      if (this.listener === listener) this.listener = null;
      for (const owner of this.owners.values()) if (owner.listener === listener) this.close(owner);
    };
    this.unsubscribe = unsubscribe;
    return unsubscribe;
  }

  private current(owner: Owner): boolean { return !owner.closed && this.owners.get(owner.sourceId) === owner; }
  private close(owner: Owner): void {
    if (owner.closed) return;
    owner.closed = true;
    if (this.owners.get(owner.sourceId) === owner) this.owners.delete(owner.sourceId);
    owner.port?.close();
  }
  private fail(owner: Owner): void {
    if (!this.current(owner) || owner.failed) return;
    owner.failed = true;
    try { owner.port!.postMessage({ type: 'failed' }); }
    catch {
      this.close(owner);
      this.notify(owner, 'Application audio capture could not transfer audio.');
    }
  }
  private notify(owner: Owner, error: string): void {
    // Invoke before another start can install a replacement input. The returned
    // promise is observed, but terminal notification never earns PCM credit.
    try { void owner.listener(owner.sourceId, { error }).catch(() => undefined); }
    catch { /* The captured owner has already been closed. */ }
  }
}
