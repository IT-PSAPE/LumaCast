export interface NdiSenderConfig {
  senderName: string;
  width: number;
  height: number;
  withAlpha: boolean;
}

export interface NdiRuntimeInfo {
  loaded: boolean;
  path: string | null;
  asyncVideoSend: boolean;
  audioSend: boolean;
}

export interface NdiNativeModule {
  initializeSender: (config: NdiSenderConfig) => void;
  sendRgbaFrame: (senderName: string, buffer: Uint8Array, width: number, height: number) => void;
  // Only present when the loaded NDI runtime exports NDIlib_send_send_audio_v2.
  sendAudioFrame?: (
    senderName: string,
    samples: Float32Array,
    sampleRate: number,
    channels: number,
    samplesPerChannel: number,
  ) => void;
  getSenderConnections?: (senderName: string, timeoutMs?: number) => number;
  // Polls the NDI tally signal from receivers. Optional because older NDI
  // runtimes / older builds of the addon don't expose it.
  getSenderTally?: (
    senderName: string,
    timeoutMs?: number,
  ) => { onProgram: boolean; onPreview: boolean } | null;
  destroySender: (senderName?: string) => void;
  getRuntimeInfo?: () => NdiRuntimeInfo;
  getAddonInfo?: () => { path: string | null };
}

export function defaultNdiModuleLoader(): NdiNativeModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@lumacast/ndi-native') as NdiNativeModule;
}
