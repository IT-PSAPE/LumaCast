import {
  NDI_FRAME_TRANSPORT_HANDSHAKE_TIMEOUT_MS,
  NDI_FRAME_TRANSPORT_VERSION,
  type NdiFrameRelease,
  type NdiFrameTransportFrame,
  type NdiOutputName,
} from '@lumacast/protocol';

export interface NdiFrameTransportPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
}

interface NdiFrameTransportClientOptions {
  onReleased: (release: NdiFrameRelease) => void;
  onFallback: (name: NdiOutputName) => void;
  onReady: (name: NdiOutputName) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRelease(value: unknown, expectedName: NdiOutputName): value is NdiFrameRelease {
  if (!isRecord(value) || value.name !== expectedName) return false;
  if (value.accepted !== true && value.accepted !== false) return false;
  if (typeof value.reason !== 'string' || typeof value.releasedAtMs !== 'number') return false;
  return value.attemptId === undefined || typeof value.attemptId === 'string';
}

/** Owns the worker-side endpoint of the direct renderer-to-utility frame channel. */
export class NdiFrameTransportClient {
  private readonly options: NdiFrameTransportClientOptions;
  private port: NdiFrameTransportPort | null = null;
  private name: NdiOutputName | null = null;
  private ready = false;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(options: NdiFrameTransportClientOptions) {
    this.options = options;
  }

  attach(name: NdiOutputName, port: NdiFrameTransportPort): void {
    this.reset();
    this.port = port;
    this.name = name;
    port.onmessage = (event) => this.handleMessage(event.data);
    port.onmessageerror = () => this.fail();
    port.start();
    try {
      port.postMessage({ type: 'handshake', version: NDI_FRAME_TRANSPORT_VERSION, name });
    } catch {
      this.fail();
      return;
    }
    this.handshakeTimer = setTimeout(() => this.fail(), NDI_FRAME_TRANSPORT_HANDSHAKE_TIMEOUT_MS);
  }

  isReady(): boolean {
    return this.ready && this.port !== null;
  }

  sendFrame(frame: NdiFrameTransportFrame): boolean {
    const port = this.port;
    if (!port || !this.ready || frame.name !== this.name) return false;
    const message: NdiFrameTransportFrame = {
      ...frame,
      ...(frame.telemetry
        ? { telemetry: { ...frame.telemetry, rendererSendAtMs: Date.now() } }
        : {}),
    };
    try {
      // Electron 35 delivers ArrayBuffer as null when a transfer list is used
      // on this worker-to-utility MessagePort path. Deliberately clone here.
      port.postMessage(message);
      return true;
    } catch {
      this.fail();
      return false;
    }
  }

  reset(): void {
    const port = this.port;
    const name = this.name;
    this.clearHandshakeTimer();
    this.port = null;
    this.name = null;
    this.ready = false;
    if (!port) return;
    port.onmessage = null;
    port.onmessageerror = null;
    try {
      if (name) port.postMessage({ type: 'close', name });
    } catch {
      // The channel may already be closed.
    }
    port.close();
  }

  private handleMessage(value: unknown): void {
    const name = this.name;
    if (!name || !isRecord(value)) {
      this.fail();
      return;
    }
    if (value.type === 'ready') {
      if (value.version !== NDI_FRAME_TRANSPORT_VERSION || value.name !== name) {
        this.fail();
        return;
      }
      this.clearHandshakeTimer();
      this.ready = true;
      this.options.onReady(name);
      return;
    }
    if (value.type === 'released' && isRelease(value.release, name)) {
      this.options.onReleased(value.release);
      return;
    }
    if (value.type === 'fallback' && value.name === name) {
      this.fail();
      return;
    }
    this.fail();
  }

  private fail(): void {
    const name = this.name;
    const port = this.port;
    this.clearHandshakeTimer();
    this.port = null;
    this.name = null;
    this.ready = false;
    if (port) {
      port.onmessage = null;
      port.onmessageerror = null;
      port.close();
    }
    if (name) this.options.onFallback(name);
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer === null) return;
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }
}
