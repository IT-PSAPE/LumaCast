import type { NdiSendSettings, NdiSource } from '../shared/ndi';

export type NdiHostCommand =
  | { requestId: string; type: 'discover' }
  | { requestId: string; type: 'startReceive'; source: NdiSource; includeAudio: boolean }
  | { requestId: string; type: 'readFrame'; receiverId: string }
  | { requestId: string; type: 'stopReceive'; receiverId: string }
  | { requestId: string; type: 'startSend'; settings: NdiSendSettings }
  | { requestId: string; type: 'sendVideo'; senderName: string; width: number; height: number; data: Uint8Array }
  | { requestId: string; type: 'sendAudio'; senderName: string; sampleRate: number; channels: number; samplesPerChannel: number; data: Float32Array }
  | { requestId: string; type: 'stopSend'; senderName: string }
  | { requestId: string; type: 'destroy' };

export type NdiHostReply =
  | { requestId: string; ok: true; value: unknown }
  | { requestId: string; ok: false; error: string };
