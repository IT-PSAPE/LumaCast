export type NdiSenderConfig = {
  senderName: string;
  width: number;
  height: number;
  withAlpha: boolean;
  /** Optional rational frame rate. Omit both to preserve the existing 30000/1001 default. */
  frameRateN?: number;
  frameRateD?: number;
};

export type NdiSource = {
  name: string;
  urlAddress?: string;
};

export type NdiReceiverOptions = {
  includeAudio?: boolean;
  receiverName?: string;
};

export type NdiReceivedVideoFrame = {
  kind: 'video';
  width: number;
  height: number;
  stride: number;
  frameRateN: number;
  frameRateD: number;
  /** BGRA pixels, bounded to 8,294,400 pixels (32 MiB). */
  data: Uint8Array;
};

export type NdiReceivedAudioFrame = {
  kind: 'audio';
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
  channelStrideBytes: number;
  /** Planar Float32 data, with one contiguous channel after another. */
  data: Float32Array;
};

export type NdiReceivedFrame = NdiReceivedVideoFrame | NdiReceivedAudioFrame;

export type NdiRuntimeInfo = {
  loaded: boolean;
  path: string | null;
  asyncVideoSend: boolean;
  audioSend: boolean;
  receive: boolean;
};

export type NdiAddonInfo = {
  path: string | null;
};

export function initializeSender(config: NdiSenderConfig): void;

/** Discover the sources currently visible to NDI-FIND, waiting no longer than timeoutMs. */
export function discoverSources(timeoutMs?: number): Promise<NdiSource[]>;

/** Create an NDI receive instance for a previously discovered source. */
export function createReceiver(source: NdiSource, options?: NdiReceiverOptions): Promise<string>;

/** Capture one video or audio frame without blocking the JavaScript thread. */
export function receiveFrame(receiverId: string, timeoutMs?: number): Promise<NdiReceivedFrame | null>;

/** Destroy a receive instance. Any current receive operation is allowed to finish first. */
export function destroyReceiver(receiverId: string): Promise<void>;

export function sendBgraFrame(senderName: string, frame: Uint8Array, width: number, height: number, stride: number): void;

export function sendRgbaFrame(senderName: string, frame: Uint8Array, width: number, height: number): void;

export function getSharedTextureSupport(): boolean;
// Trusted Electron main-process pointer. Keep the original texture lease
// alive until sendSharedTextureFrame resolves, even across process boundaries.
export function getSharedTextureId(handle: Buffer): number;
export interface SharedTextureHandle {
  platform: 'darwin' | 'win32' | 'linux';
  surfaceId?: number;
  dxgiHandle?: string;
  targetPid?: number;
  token?: string;
  modifier?: string;
  planes?: Array<{ stride: number; offset: number; size: number }>;
}
export function getSharedTextureReceiver(): string;
export function exportSharedTexture(
  info: { sharedTextureHandle?: Buffer; modifier?: string; planes?: Array<{ fd: number; stride: number; offset: number; size: number }> },
  targetPid: number, receiverEndpoint: string,
): SharedTextureHandle;
export function discardSharedTexture(handle: SharedTextureHandle): void;
export function sendSharedTextureFrame(
  senderName: string, handle: SharedTextureHandle, width: number, height: number, pixelFormat: 'bgra' | 'rgba',
): Promise<{ conversionDurationMs: number; sendDurationMs: number; frameBytes: number }>;
export function replaySharedTextureFrame(senderName: string): Promise<{ conversionDurationMs: number; sendDurationMs: number; frameBytes: number }>;

// Planar 32-bit float audio: samples = [ch0..., ch1..., ...], length = channels * samplesPerChannel.
export function sendAudioFrame(
  senderName: string,
  samples: Float32Array,
  sampleRate: number,
  channels: number,
  samplesPerChannel: number,
): void;

export function getSenderConnections(senderName: string, timeoutMs?: number): number;

// Polls the bidirectional NDI tally signal that receivers send back. Returns
// null when the loaded NDI runtime doesn't export NDIlib_send_get_tally or no
// sender is registered for senderName.
export function getSenderTally(
  senderName: string,
  timeoutMs?: number,
): { onProgram: boolean; onPreview: boolean } | null;

export function destroySender(senderName?: string): void;

export function getRuntimeInfo(): NdiRuntimeInfo;

export function getAddonInfo(): NdiAddonInfo;
