import type {
  NdiDiagnostics,
  NdiFrameTelemetry,
  NdiOutputConfig,
  NdiOutputConfigMap,
  NdiOutputName,
  NdiOutputState,
} from '@core/types';

// Sent from main process to the NDI utility process.
export type NdiHostCommand =
  | { type: 'init'; outputConfigs: NdiOutputConfigMap }
  | { type: 'setOutputEnabled'; name: NdiOutputName; enabled: boolean }
  | { type: 'updateOutputConfig'; name: NdiOutputName; config: Partial<NdiOutputConfig> }
  | {
      type: 'frame';
      name: NdiOutputName;
      buffer: ArrayBuffer;
      width: number;
      height: number;
      telemetry?: NdiFrameTelemetry;
    }
  // Hands the host a MessagePort that frames will arrive on directly from the
  // renderer (transferred ArrayBuffers, zero-copy on both legs of the hop).
  | { type: 'attach-frame-port' }
  | { type: 'destroy' };

// Frame payload sent over the renderer↔host MessageChannel. Buffer is
// transferred (zero-copy) on each post; the host replies with an ack so the
// renderer can release its back-pressure slot.
export type NdiFramePortMessage =
  | {
      type: 'frame';
      name: NdiOutputName;
      buffer: ArrayBuffer;
      width: number;
      height: number;
      telemetry?: NdiFrameTelemetry;
    };

export type NdiFramePortReply = { type: 'ack'; name: NdiOutputName };

// Emitted from the NDI utility process to the main process.
export type NdiHostEvent =
  | {
      type: 'ready';
      outputState: NdiOutputState;
      outputConfigs: NdiOutputConfigMap;
      diagnostics: NdiDiagnostics;
    }
  | { type: 'outputConfigsChanged'; outputConfigs: NdiOutputConfigMap }
  | { type: 'outputStateChanged'; outputState: NdiOutputState }
  | { type: 'diagnosticsChanged'; diagnostics: NdiDiagnostics };

// Avoid importing electron types into shared protocol; the implementation
// site can narrow this to MessagePortMain.
export interface AttachableFramePort {
  postMessage(message: unknown, transfer?: unknown[]): void;
  on?(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  start?(): void;
  close?(): void;
}

export interface NdiServiceLike {
  getOutputState(): NdiOutputState;
  getOutputConfigs(): NdiOutputConfigMap;
  getDiagnostics(): NdiDiagnostics;
  setOutputEnabled(name: NdiOutputName, enabled: boolean): NdiOutputState;
  updateOutputConfig(name: NdiOutputName, config: Partial<NdiOutputConfig>): NdiOutputConfigMap;
  receiveFrame(
    name: NdiOutputName,
    rgba: Uint8Array,
    width: number,
    height: number,
    telemetry?: NdiFrameTelemetry,
  ): void;
  onOutputStateChanged(callback: (state: NdiOutputState) => void): () => void;
  onDiagnosticsChanged(callback: (diagnostics: NdiDiagnostics) => void): () => void;
  destroy(): void;
  // Optional: implementations that can route frames over a MessagePort hand
  // the port to their backend; main wiring uses this for zero-copy transfer.
  attachFrameChannelPort?(port: AttachableFramePort): void;
}
