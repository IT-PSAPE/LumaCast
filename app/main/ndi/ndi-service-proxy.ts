import { utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import type {
  NdiDiagnostics,
  NdiFrameTelemetry,
  NdiOutputConfig,
  NdiOutputConfigMap,
  NdiOutputName,
  NdiOutputState,
} from '@core/types';
import type {
  AttachableFramePort,
  NdiHostCommand,
  NdiHostEvent,
  NdiServiceLike,
} from './ndi-protocol';

type StateChangeCallback = (state: NdiOutputState) => void;
type DiagnosticsChangeCallback = (diagnostics: NdiDiagnostics) => void;

export interface NdiServiceProxyOptions {
  outputConfigs: NdiOutputConfigMap;
  onOutputConfigsChanged: (configs: NdiOutputConfigMap) => void;
  hostModulePath: string;
}

export class NdiServiceProxy implements NdiServiceLike {
  private readonly host: UtilityProcess;
  private destroyed = false;
  private cachedOutputState: NdiOutputState = { audience: false, stage: false };
  private cachedOutputConfigs: NdiOutputConfigMap;
  private cachedDiagnostics: NdiDiagnostics;
  private readonly onOutputConfigsChanged: (configs: NdiOutputConfigMap) => void;
  private stateChangeListeners: StateChangeCallback[] = [];
  private diagnosticsChangeListeners: DiagnosticsChangeCallback[] = [];

  constructor(options: NdiServiceProxyOptions) {
    this.cachedOutputConfigs = options.outputConfigs;
    this.onOutputConfigsChanged = options.onOutputConfigsChanged;
    this.cachedDiagnostics = createInitialDiagnostics(options.outputConfigs);
    console.log(`[NdiServiceProxy] Forking host at ${options.hostModulePath}`);
    try {
      this.host = utilityProcess.fork(options.hostModulePath, [], {
        serviceName: 'ndi-host',
        stdio: 'pipe',
      });
    } catch (error) {
      console.error(`[NdiServiceProxy] Failed to fork host at ${options.hostModulePath}:`, error);
      throw error;
    }
    this.host.stdout?.on('data', (chunk: Buffer) => {
      // Route through console so the file logger captures host stdout.
      console.log(`[ndi-host] ${stripTrailingNewline(chunk.toString())}`);
    });
    this.host.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[ndi-host] ${stripTrailingNewline(chunk.toString())}`);
    });
    this.host.on('exit', (code) => {
      if (!this.destroyed) {
        console.error(`[NdiServiceProxy] Host process exited unexpectedly with code ${code}`);
      }
    });
    this.host.on('message', (event: NdiHostEvent) => this.handleHostEvent(event));
    this.send({ type: 'init', outputConfigs: options.outputConfigs });
  }

  getOutputState(): NdiOutputState {
    return { ...this.cachedOutputState };
  }

  getOutputConfigs(): NdiOutputConfigMap {
    return { ...this.cachedOutputConfigs };
  }

  getDiagnostics(): NdiDiagnostics {
    return this.cachedDiagnostics;
  }

  setOutputEnabled(name: NdiOutputName, enabled: boolean): NdiOutputState {
    this.cachedOutputState = { ...this.cachedOutputState, [name]: enabled };
    this.send({ type: 'setOutputEnabled', name, enabled });
    return this.getOutputState();
  }

  updateOutputConfig(name: NdiOutputName, config: Partial<NdiOutputConfig>): NdiOutputConfigMap {
    this.cachedOutputConfigs = {
      ...this.cachedOutputConfigs,
      [name]: { ...this.cachedOutputConfigs[name], ...config },
    };
    this.send({ type: 'updateOutputConfig', name, config });
    return this.getOutputConfigs();
  }

  receiveFrame(
    name: NdiOutputName,
    rgba: Uint8Array,
    width: number,
    height: number,
    telemetry?: NdiFrameTelemetry,
  ): void {
    if (this.destroyed) return;
    const buffer = rgba.buffer as ArrayBuffer;
    // Keep the main -> utility-process hop on plain structured clone. Electron
    // utilityProcess.postMessage only documents MessagePort transfer support;
    // attempting ArrayBuffer transfer can throw before the NDI host receives the
    // frame, leaving the sender advertised with zero frame diagnostics.
    this.send({ type: 'frame', name, buffer, width, height, telemetry });
  }

  onOutputStateChanged(callback: StateChangeCallback): () => void {
    this.stateChangeListeners.push(callback);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter((listener) => listener !== callback);
    };
  }

  onDiagnosticsChanged(callback: DiagnosticsChangeCallback): () => void {
    this.diagnosticsChangeListeners.push(callback);
    return () => {
      this.diagnosticsChangeListeners = this.diagnosticsChangeListeners.filter((listener) => listener !== callback);
    };
  }

  attachFrameChannelPort(port: AttachableFramePort): void {
    if (this.destroyed) return;
    // Forward the port to the utility host. Once attached, the host receives
    // frame messages from the renderer directly via this port (zero-copy
    // ArrayBuffer transfer on each post).
    this.host.postMessage({ type: 'attach-frame-port' } as NdiHostCommand, [port as unknown as MessagePortMain]);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.send({ type: 'destroy' });
    } catch {
      // ignore — we'll kill the host below
    }
    try {
      this.host.kill();
    } catch (error) {
      console.error('[NdiServiceProxy] Error killing host:', error);
    }
  }

  private send(cmd: NdiHostCommand): void {
    if (this.destroyed) return;
    this.host.postMessage(cmd);
  }

  private handleHostEvent(event: NdiHostEvent): void {
    switch (event.type) {
      case 'ready':
        this.cachedOutputState = event.outputState;
        this.cachedOutputConfigs = event.outputConfigs;
        this.cachedDiagnostics = event.diagnostics;
        for (const listener of this.stateChangeListeners) listener(event.outputState);
        for (const listener of this.diagnosticsChangeListeners) listener(event.diagnostics);
        break;
      case 'outputConfigsChanged':
        this.cachedOutputConfigs = event.outputConfigs;
        this.onOutputConfigsChanged(event.outputConfigs);
        break;
      case 'outputStateChanged':
        this.cachedOutputState = event.outputState;
        for (const listener of this.stateChangeListeners) listener(event.outputState);
        break;
      case 'diagnosticsChanged':
        this.cachedDiagnostics = event.diagnostics;
        for (const listener of this.diagnosticsChangeListeners) listener(event.diagnostics);
        break;
    }
  }
}

function stripTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

function createInitialDiagnostics(configs: NdiOutputConfigMap): NdiDiagnostics {
  return {
    outputState: { audience: false, stage: false },
    outputConfig: { ...configs.audience },
    outputConfigs: { ...configs },
    runtimeLoaded: false,
    runtimePath: null,
    activeSender: null,
    senders: { audience: null, stage: null },
    sourceStatus: 'idle',
    lastError: null,
  };
}
