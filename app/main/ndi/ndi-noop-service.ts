import type {
  NdiDiagnostics,
  NdiOutputConfig,
  NdiOutputConfigMap,
  NdiOutputName,
  NdiOutputState,
} from '@core/types';
import type { NdiServiceLike } from './ndi-protocol';

/**
 * Used as a fallback when the NDI utility process can't be started — the rest
 * of the app stays usable; only NDI output is disabled.
 */
export class NoopNdiService implements NdiServiceLike {
  private outputConfigs: NdiOutputConfigMap;
  private readonly state: NdiOutputState = { audience: false, stage: false };
  private readonly errorMessage: string;

  constructor(outputConfigs: NdiOutputConfigMap, errorMessage: string) {
    this.outputConfigs = outputConfigs;
    this.errorMessage = errorMessage;
  }

  getOutputState(): NdiOutputState {
    return { ...this.state };
  }

  getOutputConfigs(): NdiOutputConfigMap {
    return { ...this.outputConfigs };
  }

  getDiagnostics(): NdiDiagnostics {
    return {
      outputState: this.getOutputState(),
      outputConfig: { ...this.outputConfigs.audience },
      outputConfigs: this.getOutputConfigs(),
      runtimeLoaded: false,
      runtimePath: null,
      activeSender: null,
      senders: { audience: null, stage: null },
      sourceStatus: 'idle',
      lastError: this.errorMessage,
    };
  }

  setOutputEnabled(_name: NdiOutputName, _enabled: boolean): NdiOutputState {
    return this.getOutputState();
  }

  updateOutputConfig(name: NdiOutputName, config: Partial<NdiOutputConfig>): NdiOutputConfigMap {
    this.outputConfigs = {
      ...this.outputConfigs,
      [name]: { ...this.outputConfigs[name], ...config },
    };
    return this.getOutputConfigs();
  }

  receiveFrame(): void {
    // Silently dropped — NDI output is unavailable.
  }

  onOutputStateChanged(): () => void {
    return () => undefined;
  }

  onDiagnosticsChanged(): () => void {
    return () => undefined;
  }

  destroy(): void {
    // Nothing to tear down.
  }
}
