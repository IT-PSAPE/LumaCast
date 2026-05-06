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
  | { type: 'destroy' };

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
}
