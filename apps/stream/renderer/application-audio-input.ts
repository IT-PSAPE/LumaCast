import { APPLICATION_AUDIO_PACKET_BYTES, APPLICATION_AUDIO_WINDOW_PACKETS, APPLICATION_AUDIO_READY_MS } from '../shared/application-audio-transport';

/** A receipt remains outstanding until the processor plays the final frame. */
export class ApplicationAudioInputTransport {
  private sequence = 0;
  private closed = false;
  private failure: Error | null = null;
  private ready = false;
  private readiness: { promise: Promise<boolean>; resolve(value: boolean): void; reject(error: Error): void } | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private failureListener: ((error: Error) => void) | null = null;
  private readonly pending = new Map<number, { resolve(value: boolean): void; reject(error: Error): void }>();

  constructor(private readonly node: Pick<AudioWorkletNode, 'port' | 'addEventListener' | 'removeEventListener'>) {
    node.port.onmessage = ({ data }) => {
      if (this.closed) return;
      if (data?.type === 'ready' && !this.ready) {
        this.ready = true;
        this.readiness?.resolve(true);
        this.clearReadiness();
        return;
      }
      if (data?.type === 'error') { this.fail(new Error('The application-audio processor stopped accepting audio.')); return; }
      const first = this.pending.keys().next().value;
      if (first === undefined || data?.type !== 'consumed' || !Number.isSafeInteger(data.sequence) || first !== data.sequence) {
        this.fail(new Error('The application-audio processor returned an invalid receipt.')); return;
      }
      const receipt = this.pending.get(first)!;
      this.pending.delete(first);
      receipt.resolve(true);
    };
    node.port.onmessageerror = () => this.fail(new Error('The application-audio processor could not transfer audio.'));
    node.addEventListener('processorerror', this.onProcessorError);
    node.port.start();
  }

  onError(listener: (error: Error) => void): () => void {
    if (this.failure) { listener(this.failure); return () => {}; }
    if (this.closed) return () => {};
    this.failureListener = listener;
    return () => { if (this.failureListener === listener) this.failureListener = null; };
  }

  /** Called after context.resume(); capture cannot start before actual rendering. */
  waitUntilReady(): Promise<boolean> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error('The application-audio input closed before readiness.'));
    if (this.ready) return Promise.resolve(true);
    if (!this.readiness) {
      let resolve!: (value: boolean) => void;
      let reject!: (error: Error) => void;
      const promise = new Promise<boolean>((done, fail) => { resolve = done; reject = fail; });
      this.readiness = { promise, resolve, reject };
      this.readyTimer = setTimeout(() => this.fail(new Error('The application-audio processor did not become ready.')), APPLICATION_AUDIO_READY_MS);
    }
    return this.readiness.promise;
  }

  push(buffer: ArrayBuffer): Promise<boolean> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.resolve(false);
    if (buffer.byteLength === 0 || buffer.byteLength > APPLICATION_AUDIO_PACKET_BYTES || buffer.byteLength % 8
      || this.pending.size >= APPLICATION_AUDIO_WINDOW_PACKETS) {
      this.fail(new Error('The application-audio processor queue exceeded its audio window.'));
      return Promise.reject(this.failure);
    }
    const sequence = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(sequence, { resolve, reject });
      try { this.node.port.postMessage({ type: 'pcm', sequence, buffer }, [buffer]); }
      catch { this.fail(new Error('The application-audio processor could not receive audio.')); }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failureListener = null;
    this.readiness?.reject(new Error('The application-audio input closed before readiness.'));
    this.clearReadiness();
    for (const receipt of this.pending.values()) receipt.resolve(false);
    this.pending.clear();
    this.dispose();
  }

  private readonly onProcessorError = () => this.fail(new Error('The application-audio processor failed.'));
  private fail(error: Error): void {
    if (this.closed) return;
    this.failure = error;
    this.closed = true;
    const listener = this.failureListener;
    this.failureListener = null;
    this.readiness?.reject(error);
    this.clearReadiness();
    for (const receipt of this.pending.values()) receipt.reject(error);
    this.pending.clear();
    this.dispose();
    listener?.(error);
  }
  private clearReadiness(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    this.readiness = null;
  }
  private dispose(): void {
    this.node.removeEventListener('processorerror', this.onProcessorError);
    this.node.port.onmessage = null;
    this.node.port.onmessageerror = null;
    try { this.node.port.postMessage({ type: 'stop' }); } catch { /* Already closed. */ }
    this.node.port.close();
  }
}
