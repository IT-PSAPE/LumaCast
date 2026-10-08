export type NdiSenderConfig = {
  senderName: string;
  width: number;
  height: number;
  withAlpha: boolean;
};

export type NdiRuntimeInfo = {
  loaded: boolean;
  path: string | null;
  asyncVideoSend: boolean;
  audioSend: boolean;
};

export type NdiAddonInfo = {
  path: string | null;
};

export function initializeSender(config: NdiSenderConfig): void;

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
