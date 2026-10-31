import { ipcMain, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { NdiFrame, NdiSendSettings, NdiSource, StreamNdiAPI } from '../shared/ndi';
import { IPC_CHANNELS } from './ipc-channels';
import type { NdiHostCommand, NdiHostReply } from './ndi-host-protocol';

const MAX_RECEIVERS = 8;
const MAX_VIDEO_WIDTH = 1920;
const MAX_VIDEO_HEIGHT = 1080;
const MAX_VIDEO_BYTES = MAX_VIDEO_WIDTH * MAX_VIDEO_HEIGHT * 4;
const MAX_AUDIO_CHANNELS = 8;
const MAX_AUDIO_SAMPLES_PER_CHANNEL = 8192;
const MAX_RECEIVE_PIXELS = 8_294_400;
const MAX_RECEIVE_BYTES = MAX_RECEIVE_PIXELS * 4;
const MAX_RECEIVE_AUDIO_CHANNELS = 64;
const MAX_RECEIVE_AUDIO_SAMPLES = 1_048_576;
const MAX_RECEIVE_AUDIO_SAMPLE_RATE = 384_000;
const MAX_RENDER_AUDIO_CHANNELS = 16;
const MAX_RENDER_AUDIO_SAMPLES_PER_CHANNEL = 192_000;
const MAX_RENDER_AUDIO_SAMPLE_RATE = 192_000;
const MAX_PENDING_REQUESTS = 256;
const MAX_PENDING_VIDEO_REQUESTS = 2;
const CONTROL_TIMEOUT_MS = 10_000;
const READ_FRAME_TIMEOUT_MS = 1_000;
const VIDEO_SEND_TIMEOUT_MS = 3_000;
const HOST_CLOSE_TIMEOUT_MS = 1_000;

type HostCommand = NdiHostCommand extends infer Command
  ? Command extends { requestId: string }
    ? Omit<Command, 'requestId'>
    : never
  : never;
type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  video: boolean;
};
type ReceiverSession = {
  nativeId: string;
  reading: boolean;
  stopTask: Promise<void> | null;
};
type UtilityProcessFork = typeof utilityProcess.fork;
export type NdiIpcOptions = {
  fork?: UtilityProcessFork;
  ipc?: Pick<typeof ipcMain, 'handle' | 'removeHandler'>;
  requestTimeoutMs?: number;
  readFrameTimeoutMs?: number;
  videoSendTimeoutMs?: number;
  closeTimeoutMs?: number;
};

export interface NdiIpcRegistration {
  unregister(): void;
  close(): Promise<void>;
}

/** Keeps all native NDI work in an Electron utility process. */
class NdiUtilityClient {
  private host: UtilityProcess | null = null;
  private nextRequestId = 0;
  private pending = new Map<string, PendingRequest>();
  private pendingVideoRequests = 0;
  private failureListeners = new Set<() => void>();
  private closing = false;
  private closed = false;
  private closeTask: Promise<void> | null = null;

  constructor(
    private readonly hostModulePath: string,
    private readonly fork: UtilityProcessFork,
    private readonly requestTimeoutMs = CONTROL_TIMEOUT_MS,
    private readonly closeTimeoutMs = HOST_CLOSE_TIMEOUT_MS,
  ) {}

  onHostFailure(listener: () => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  terminate(error: Error): void {
    const host = this.host;
    if (!host) return;
    this.handleHostFailure(host, error);
    try { host.kill(); } catch { /* The utility process may already have exited. */ }
  }

  request(command: HostCommand, timeoutMs = this.requestTimeoutMs): Promise<unknown> {
    if (this.closing || this.closed) return Promise.reject(new Error('The NDI service is shutting down.'));
    let host: UtilityProcess;
    try {
      host = this.ensureHost();
    } catch (error) {
      return Promise.reject(asError(error, 'The NDI utility process could not start.'));
    }
    return this.post(host, command, timeoutMs);
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closing = true;
    this.closeTask = this.closeHost();
    return this.closeTask;
  }

  private ensureHost(): UtilityProcess {
    if (this.host) return this.host;
    const host = this.fork(this.hostModulePath, [], {
      serviceName: 'lumastream-ndi',
      stdio: 'pipe',
    });
    this.host = host;
    // Electron UtilityProcess emits the structured-clone payload directly;
    // only the utility process's process.parentPort API wraps incoming data.
    host.on('message', (reply: NdiHostReply) => this.handleReply(host, reply));
    host.once('exit', (code) => this.handleHostFailure(host, new Error(`The NDI utility process exited (${String(code)}).`)));
    host.on('error', (error) => {
      this.handleHostFailure(host, asError(error, 'The NDI utility process failed.'));
      try { host.kill(); } catch { /* The utility process may already have exited. */ }
    });
    return host;
  }

  private post(host: UtilityProcess, command: HostCommand, timeoutMs: number): Promise<unknown> {
    if (this.pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error('The NDI utility process is busy.'));
    }
    const video = command.type === 'sendVideo';
    if (video && this.pendingVideoRequests >= MAX_PENDING_VIDEO_REQUESTS) {
      return Promise.reject(new Error('The NDI video sender is busy.'));
    }
    const requestId = String(++this.nextRequestId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handleHostFailure(host, new Error('The NDI utility process did not respond in time.'));
        try { host.kill(); } catch { /* It may already have exited. */ }
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer, video });
      if (video) this.pendingVideoRequests += 1;
      try {
        host.postMessage({ ...command, requestId } as NdiHostCommand);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        if (video) this.pendingVideoRequests -= 1;
        const failure = asError(error, 'The NDI utility process could not receive a request.');
        reject(failure);
        this.handleHostFailure(host, failure);
        try { host.kill(); } catch { /* It may already have exited. */ }
      }
    });
  }

  private handleReply(host: UtilityProcess, reply: NdiHostReply): void {
    if (this.host !== host || !reply || typeof reply.requestId !== 'string') return;
    const pending = this.pending.get(reply.requestId);
    if (!pending) return;
    this.pending.delete(reply.requestId);
    clearTimeout(pending.timer);
    if (pending.video) this.pendingVideoRequests -= 1;
    if (reply.ok) pending.resolve(reply.value);
    else pending.reject(new Error(reply.error));
  }

  private handleHostFailure(host: UtilityProcess, error: Error): void {
    if (this.host !== host) return;
    this.host = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.pendingVideoRequests = 0;
    for (const listener of this.failureListeners) listener();
    if (this.closing) this.closed = true;
  }

  private async closeHost(): Promise<void> {
    const host = this.host;
    if (!host) {
      this.closed = true;
      return;
    }

    try {
      await this.post(host, { type: 'destroy' }, this.closeTimeoutMs);
    } catch {
      // Kill the isolated host below even if native cleanup fails or times out.
    }
    let closeTimer: NodeJS.Timeout | undefined;
    const exited = new Promise<void>((resolve) => {
      host.once('exit', () => resolve());
    });
    try { host.kill(); } catch { /* The process may already have exited. */ }
    await Promise.race([
      exited,
      new Promise<void>((resolve) => { closeTimer = setTimeout(resolve, 500); }),
    ]);
    if (closeTimer) clearTimeout(closeTimer);
    if (this.host === host) {
      this.handleHostFailure(host, new Error('The NDI utility process was closed.'));
    }
    this.closed = true;
  }
}

/** Validated application API layered over the native host request protocol. */
class NdiBridge {
  private readonly receivers = new Map<string, ReceiverSession>();
  private receiverStarts = 0;
  private sender: { id: string; senderName: string; settings: NdiSendSettings } | null = null;
  private senderStarting = false;

  constructor(
    private readonly host: NdiUtilityClient,
    private readonly readFrameTimeoutMs = READ_FRAME_TIMEOUT_MS,
    private readonly videoSendTimeoutMs = VIDEO_SEND_TIMEOUT_MS,
  ) {
    host.onHostFailure(() => {
      this.receivers.clear();
      this.sender = null;
    });
  }

  async discover(): Promise<NdiSource[]> {
    const raw = await this.host.request({ type: 'discover' });
    if (!Array.isArray(raw) || raw.length > 256) throw new Error('The NDI utility returned an invalid source list.');
    return raw.map(validateSource);
  }

  async startReceive(sourceValue: NdiSource, includeAudioValue?: unknown): Promise<string> {
    const source = validateSource(sourceValue);
    if (includeAudioValue !== undefined && typeof includeAudioValue !== 'boolean') {
      throw new Error('NDI receive audio setting must be a boolean.');
    }
    const includeAudio = includeAudioValue ?? true;
    if (this.receivers.size + this.receiverStarts >= MAX_RECEIVERS) {
      throw new Error('LumaStream supports up to eight NDI receivers at a time.');
    }
    this.receiverStarts += 1;
    try {
      const nativeId = await this.host.request({ type: 'startReceive', source, includeAudio });
      if (typeof nativeId !== 'string' || nativeId.length < 1 || nativeId.length > 256) {
        throw new Error('The NDI utility returned an invalid receiver ID.');
      }
      const id = randomUUID();
      this.receivers.set(id, { nativeId, reading: false, stopTask: null });
      return id;
    } finally {
      this.receiverStarts -= 1;
    }
  }

  async readFrame(idValue: string): Promise<NdiFrame | null> {
    const id = validateSessionId(idValue);
    const receiver = this.receivers.get(id);
    if (!receiver) throw new Error('The NDI receiver session was not found.');
    if (receiver.stopTask) throw new Error('The NDI receiver is stopping.');
    if (receiver.reading) throw new Error('An NDI frame read is already in progress for this receiver.');
    receiver.reading = true;
    try {
      const frame = await this.host.request({ type: 'readFrame', receiverId: receiver.nativeId }, this.readFrameTimeoutMs);
      return validateFrame(frame);
    } finally {
      if (this.receivers.get(id) === receiver) receiver.reading = false;
    }
  }

  async stopReceive(idValue: string): Promise<void> {
    const id = validateSessionId(idValue);
    const receiver = this.receivers.get(id);
    if (!receiver) return;
    if (receiver.stopTask) return receiver.stopTask;
    const stopTask = this.host.request({ type: 'stopReceive', receiverId: receiver.nativeId }).then(
      () => {
        if (this.receivers.get(id) === receiver) this.receivers.delete(id);
      },
      (error: unknown) => {
        this.host.terminate(asError(error, 'The NDI receiver could not be stopped.'));
        if (this.receivers.get(id) === receiver) receiver.stopTask = null;
        throw error;
      },
    );
    receiver.stopTask = stopTask;
    return stopTask;
  }

  async startSend(settingsValue: NdiSendSettings): Promise<string> {
    const settings = validateSendSettings(settingsValue);
    if (this.sender || this.senderStarting) throw new Error('LumaStream supports one NDI sender at a time.');
    this.senderStarting = true;
    try {
      const senderName = await this.host.request({ type: 'startSend', settings });
      if (senderName !== settings.senderName) throw new Error('The NDI utility returned an invalid sender name.');
      const id = randomUUID();
      this.sender = { id, senderName, settings };
      return id;
    } finally {
      this.senderStarting = false;
    }
  }

  async sendVideo(idValue: string, frameValue: { width: number; height: number; data: Uint8Array }): Promise<void> {
    const sender = this.requireSender(idValue);
    if (!frameValue || frameValue.width !== sender.settings.width || frameValue.height !== sender.settings.height
      || !(frameValue.data instanceof Uint8Array) || frameValue.data.byteLength !== sender.settings.width * sender.settings.height * 4) {
      throw new Error('NDI video frames must be tightly packed RGBA at the configured output dimensions.');
    }
    await this.host.request({
      type: 'sendVideo',
      senderName: sender.senderName,
      width: frameValue.width,
      height: frameValue.height,
      data: frameValue.data,
    }, this.videoSendTimeoutMs);
  }

  async sendAudio(idValue: string, frameValue: { data: Float32Array; sampleRate: number; channels: number; samplesPerChannel: number }): Promise<void> {
    const sender = this.requireSender(idValue);
    if (!frameValue || !(frameValue.data instanceof Float32Array)
      || !Number.isInteger(frameValue.sampleRate) || frameValue.sampleRate < 8000 || frameValue.sampleRate > 192000
      || !Number.isInteger(frameValue.channels) || frameValue.channels < 1 || frameValue.channels > MAX_AUDIO_CHANNELS
      || !Number.isInteger(frameValue.samplesPerChannel) || frameValue.samplesPerChannel < 1 || frameValue.samplesPerChannel > MAX_AUDIO_SAMPLES_PER_CHANNEL
      || frameValue.data.length !== frameValue.channels * frameValue.samplesPerChannel) {
      throw new Error('NDI audio frames must contain bounded planar Float32 samples with matching channel dimensions.');
    }
    await this.host.request({
      type: 'sendAudio',
      senderName: sender.senderName,
      sampleRate: frameValue.sampleRate,
      channels: frameValue.channels,
      samplesPerChannel: frameValue.samplesPerChannel,
      data: frameValue.data,
    }, this.videoSendTimeoutMs);
  }

  async stopSend(idValue: string): Promise<void> {
    const sender = this.sender;
    if (!sender || sender.id !== validateSessionId(idValue)) return;
    try {
      await this.host.request({ type: 'stopSend', senderName: sender.senderName });
    } catch (error) {
      // Native teardown failure leaves sender state unknown. Discard the whole
      // isolated host so the next session starts from a clean native runtime.
      this.host.terminate(asError(error, 'The NDI sender could not be stopped.'));
      throw error;
    }
    if (this.sender === sender) this.sender = null;
  }

  close(): Promise<void> {
    return this.host.close();
  }

  private requireSender(idValue: string) {
    const sender = this.sender;
    if (!sender || sender.id !== validateSessionId(idValue)) throw new Error('The NDI sender session was not found.');
    return sender;
  }
}

export function registerNdiIpc(
  getContents: () => WebContents | null,
  isTrustedUrl: (url: string) => boolean,
  hostModulePath: string,
  options: NdiIpcOptions = {},
): NdiIpcRegistration {
  const ipc = options.ipc ?? ipcMain;
  const host = new NdiUtilityClient(
    hostModulePath,
    options.fork ?? ((...args) => utilityProcess.fork(...args)),
    options.requestTimeoutMs,
    options.closeTimeoutMs,
  );
  const bridge = new NdiBridge(host, options.readFrameTimeoutMs, options.videoSendTimeoutMs);
  const authorize = (event: IpcMainInvokeEvent): void => {
    const contents = getContents();
    const frame = event.senderFrame;
    if (!contents || event.sender !== contents || !frame || frame !== contents.mainFrame || !isTrustedUrl(frame.url)) {
      throw new Error('Untrusted renderer invocation.');
    }
  };
  const handlers: Array<[string, (event: IpcMainInvokeEvent, ...args: any[]) => unknown]> = [
    [IPC_CHANNELS.ndiDiscover, (event) => { authorize(event); return bridge.discover(); }],
    [IPC_CHANNELS.ndiStartReceive, (event, source: NdiSource, includeAudio?: unknown) => { authorize(event); return bridge.startReceive(source, includeAudio); }],
    [IPC_CHANNELS.ndiReadFrame, (event, id: string) => { authorize(event); return bridge.readFrame(id); }],
    [IPC_CHANNELS.ndiStopReceive, (event, id: string) => { authorize(event); return bridge.stopReceive(id); }],
    [IPC_CHANNELS.ndiStartSend, (event, settings: NdiSendSettings) => { authorize(event); return bridge.startSend(settings); }],
    [IPC_CHANNELS.ndiSendVideo, (event, id: string, frame: Parameters<StreamNdiAPI['sendVideo']>[1]) => { authorize(event); return bridge.sendVideo(id, frame); }],
    [IPC_CHANNELS.ndiSendAudio, (event, id: string, frame: Parameters<StreamNdiAPI['sendAudio']>[1]) => { authorize(event); return bridge.sendAudio(id, frame); }],
    [IPC_CHANNELS.ndiStopSend, (event, id: string) => { authorize(event); return bridge.stopSend(id); }],
  ];
  for (const [channel, handler] of handlers) ipc.handle(channel, handler);

  let unregistered = false;
  return {
    unregister() {
      if (unregistered) return;
      unregistered = true;
      for (const [channel] of handlers) ipc.removeHandler(channel);
    },
    close: () => bridge.close(),
  };
}

function validateSource(value: unknown): NdiSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The NDI source is invalid.');
  const source = value as Record<string, unknown>;
  if (typeof source.name !== 'string' || source.name.trim().length === 0 || source.name.length > 512
    || /[\u0000-\u001f\u007f]/.test(source.name)
    || (source.urlAddress !== undefined && (typeof source.urlAddress !== 'string' || source.urlAddress.length > 2048 || /[\u0000-\u001f\u007f]/.test(source.urlAddress)))) {
    throw new Error('The NDI source is invalid.');
  }
  return {
    name: source.name,
    ...(typeof source.urlAddress === 'string' ? { urlAddress: source.urlAddress } : {}),
  };
}

function validateSendSettings(value: unknown): NdiSendSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NDI sender settings are invalid.');
  const settings = value as Record<string, unknown>;
  const frameRateN = settings.frameRateN;
  const frameRateD = settings.frameRateD;
  if (typeof settings.senderName !== 'string' || settings.senderName.trim().length === 0 || settings.senderName.length > 128
    || /[\u0000-\u001f\u007f]/.test(settings.senderName)
    || !Number.isInteger(settings.width) || Number(settings.width) < 1 || Number(settings.width) > MAX_VIDEO_WIDTH
    || !Number.isInteger(settings.height) || Number(settings.height) < 1 || Number(settings.height) > MAX_VIDEO_HEIGHT
    || Number(settings.width) * Number(settings.height) * 4 > MAX_VIDEO_BYTES
    || !Number.isInteger(frameRateN) || !Number.isInteger(frameRateD)
    || Number(frameRateN) < 1 || Number(frameRateN) > 240000 || Number(frameRateD) < 1 || Number(frameRateD) > 10000
    || Number(frameRateN) / Number(frameRateD) < 1 || Number(frameRateN) / Number(frameRateD) > 120) {
    throw new Error('NDI sender settings must use a valid name, dimensions up to 1920×1080, and supported frame rate.');
  }
  return {
    senderName: settings.senderName,
    width: settings.width as number,
    height: settings.height as number,
    frameRateN: frameRateN as number,
    frameRateD: frameRateD as number,
  };
}

function validateFrame(value: unknown): NdiFrame | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The NDI receiver returned an invalid frame.');
  const frame = value as Record<string, unknown>;
  if (frame.kind === 'video') {
    const data = frame.data;
    const width = frame.width;
    const height = frame.height;
    const stride = frame.stride;
    const frameRateN = frame.frameRateN;
    const frameRateD = frame.frameRateD;
    if (!(data instanceof Uint8Array) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || Number(width) < 1 || Number(height) < 1 || Number(width) * Number(height) > MAX_RECEIVE_PIXELS
      || !Number.isSafeInteger(stride) || Number(stride) < Number(width) * 4 || Number(stride) * Number(height) > MAX_RECEIVE_BYTES
      || data.byteLength < Number(stride) * Number(height)
      || !Number.isInteger(frameRateN) || !Number.isInteger(frameRateD) || Number(frameRateN) < 1 || Number(frameRateD) < 1) {
      throw new Error('The NDI receiver returned an invalid video frame.');
    }
    return { kind: 'video', width: Number(width), height: Number(height), stride: Number(stride), frameRateN: Number(frameRateN), frameRateD: Number(frameRateD), data };
  }
  if (frame.kind === 'audio') {
    const data = frame.data;
    const sampleRate = frame.sampleRate;
    const channels = frame.channels;
    const samplesPerChannel = frame.samplesPerChannel;
    const channelStrideBytes = frame.channelStrideBytes;
    if (!(data instanceof Float32Array) || !Number.isSafeInteger(sampleRate) || Number(sampleRate) < 8000 || Number(sampleRate) > MAX_RECEIVE_AUDIO_SAMPLE_RATE
      || !Number.isInteger(channels) || Number(channels) < 1 || Number(channels) > MAX_RECEIVE_AUDIO_CHANNELS
      || !Number.isSafeInteger(samplesPerChannel) || Number(samplesPerChannel) < 1
      || Number(samplesPerChannel) * Number(channels) > MAX_RECEIVE_AUDIO_SAMPLES
      || !Number.isSafeInteger(channelStrideBytes) || Number(channelStrideBytes) !== Number(samplesPerChannel) * 4
      || data.length !== Number(samplesPerChannel) * Number(channels)) {
      throw new Error('The NDI receiver returned an invalid audio frame.');
    }
    if (Number(sampleRate) > MAX_RENDER_AUDIO_SAMPLE_RATE
      || Number(channels) > MAX_RENDER_AUDIO_CHANNELS
      || Number(samplesPerChannel) > MAX_RENDER_AUDIO_SAMPLES_PER_CHANNEL) return null;
    return { kind: 'audio', sampleRate: Number(sampleRate), channels: Number(channels), samplesPerChannel: Number(samplesPerChannel), channelStrideBytes: Number(channelStrideBytes), data };
  }
  throw new Error('The NDI receiver returned an unknown frame type.');
}

function validateSessionId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new Error('The NDI session ID is invalid.');
  return value;
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}
