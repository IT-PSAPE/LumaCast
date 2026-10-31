export interface NdiSource {
  name: string;
  urlAddress?: string;
}

export type NdiFrame = {
  kind: 'video';
  width: number;
  height: number;
  stride: number;
  frameRateN: number;
  frameRateD: number;
  data: Uint8Array;
} | {
  kind: 'audio';
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
  channelStrideBytes: number;
  data: Float32Array;
};

export interface NdiSendSettings {
  senderName: string;
  width: number;
  height: number;
  frameRateN: number;
  frameRateD: number;
}

/** Optional native feature. Camera and streaming functions do not depend on NDI. */
export interface StreamNdiAPI {
  discover(): Promise<NdiSource[]>;
  startReceive(source: NdiSource, includeAudio?: boolean): Promise<string>;
  readFrame(id: string): Promise<NdiFrame | null>;
  stopReceive(id: string): Promise<void>;
  startSend(settings: NdiSendSettings): Promise<string>;
  sendVideo(id: string, frame: { width: number; height: number; data: Uint8Array }): Promise<void>;
  sendAudio(id: string, frame: { data: Float32Array; sampleRate: number; channels: number; samplesPerChannel: number }): Promise<void>;
  stopSend(id: string): Promise<void>;
}
