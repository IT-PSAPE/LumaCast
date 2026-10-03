import { MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';
import type {
  NdiDiagnostics,
  NdiGpuTransport,
  NdiGpuFrameResult,
  NdiSharedTextureHandle,
  NdiFrameRelease,
  NdiFrameTelemetry,
  NdiOutputConfig,
  NdiOutputConfigMap,
  NdiOutputName,
  NdiOutputState,
} from '@lumacast/protocol';
import type {
  BlackoutFlushOptions,
  NdiHostCommand,
  NdiHostEvent,
  NdiServiceLike,
} from '@lumacast/engine';

type StateChangeCallback = (state: NdiOutputState) => void;
type DiagnosticsChangeCallback = (diagnostics: NdiDiagnostics) => void;
type FrameReleasedCallback = (release: NdiFrameRelease) => void;
const TEARDOWN_ACK_TIMEOUT_MS = 1_000;

export interface NdiServiceProxyOptions {
  outputConfigs: NdiOutputConfigMap;
  onOutputConfigsChanged: (configs: NdiOutputConfigMap) => void;
  hostModulePath: string;
}

export class NdiServiceProxy implements NdiServiceLike {
  private readonly host: UtilityProcess;
  private destroyed = false;
  private teardownStarted = false;
  private hostKilled = false;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private cachedOutputState: NdiOutputState = { audience: false, stage: false };
  private cachedOutputConfigs: NdiOutputConfigMap;
  private cachedDiagnostics: NdiDiagnostics;
  private readonly onOutputConfigsChanged: (configs: NdiOutputConfigMap) => void;
  private stateChangeListeners: StateChangeCallback[] = [];
  private diagnosticsChangeListeners: DiagnosticsChangeCallback[] = [];
  private gpuTransport: NdiGpuTransport | null = null;
  private hostExited = false;
  private gpuPending = new Map<string, { resolve: (result: NdiGpuFrameResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private frameReleasedListeners: FrameReleasedCallback[] = [];

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
      this.hostExited = true;
      this.gpuTransport = null;
      for (const pending of this.gpuPending.values()) { clearTimeout(pending.timer); pending.reject(new Error('NDI host exited before texture completion')); }
      this.gpuPending.clear();
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

  reportGpuSourceError(message: string): void { this.send({ type: 'gpuSourceError', message: message.slice(0, 1024) }); }

  getGpuTransport(): NdiGpuTransport | null { return this.gpuTransport; }

  submitGpuFrame(name: NdiOutputName, handle: NdiSharedTextureHandle, format: string, telemetry: NdiFrameTelemetry): Promise<NdiGpuFrameResult> {
    if (this.destroyed || this.teardownStarted || this.hostExited || !this.gpuTransport?.supported || !telemetry.attemptId) {
      throw new Error('NDI GPU host unavailable');
    }
    const attemptId = telemetry.attemptId;
    return new Promise((resolve, reject) => {
      // A timeout terminates the reader. Input leases are released only on its exit event.
      const timer = setTimeout(() => { this.host.kill(); }, 5000);
      this.gpuPending.set(attemptId, { resolve, reject, timer });
      try { this.send({ type: 'gpuFrame', name, handle, format, telemetry: { ...telemetry, proxyForwardedAtMs: Date.now() } }); }
      catch (error) {
        clearTimeout(timer);
        this.gpuPending.delete(attemptId);
        (require('@lumacast/ndi-native') as typeof import('@lumacast/ndi-native')).discardSharedTexture(handle);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  createFrameTransport(name: NdiOutputName): MessagePortMain | null {
    if (this.destroyed || this.teardownStarted) return null;
    const { port1, port2 } = new MessageChannelMain();
    try {
      this.host.postMessage({ type: 'attachFramePort', name } satisfies NdiHostCommand, [port2]);
      return port1;
    } catch (error) {
      port1.close();
      port2.close();
      console.error(`[NdiServiceProxy] Failed to attach ${name} frame transport:`, error);
      return null;
    }
  }

  createAudioTransport(name: NdiOutputName): MessagePortMain | null {
    if (this.destroyed || this.teardownStarted) return null;
    const { port1, port2 } = new MessageChannelMain();
    try {
      this.host.postMessage({ type: 'attachAudioPort', name } satisfies NdiHostCommand, [port2]);
      return port1;
    } catch (error) {
      port1.close();
      port2.close();
      console.error(`[NdiServiceProxy] Failed to attach ${name} audio transport:`, error);
      return null;
    }
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
    if (this.destroyed || this.teardownStarted) return;
    const buffer = rgba.buffer as ArrayBuffer;
    // Keep the main -> utility-process hop on plain structured clone. Electron
    // utilityProcess.postMessage only documents MessagePort transfer support;
    // attempting ArrayBuffer transfer can throw before the NDI host receives the
    // frame, leaving the sender advertised with zero frame diagnostics.
    const stamped: NdiFrameTelemetry | undefined = telemetry
      ? { ...telemetry, proxyForwardedAtMs: Date.now() }
      : undefined;
    this.send({ type: 'frame', name, buffer, width, height, telemetry: stamped });
  }

  receiveAudioFrame(
    name: NdiOutputName,
    samples: Float32Array,
    sampleRate: number,
    channels: number,
    samplesPerChannel: number,
  ): void {
    if (this.destroyed || this.teardownStarted) return;
    // Copy into a fresh ArrayBuffer so structured clone serializes only the
    // actual samples — `samples.buffer` may be a view into a larger backing
    // buffer (e.g. when slicing a worklet output).
    const copy = samples.slice();
    this.send({
      type: 'audio',
      name,
      buffer: copy.buffer as ArrayBuffer,
      sampleRate,
      channels,
      samplesPerChannel,
    });
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

  onFrameReleased(callback: FrameReleasedCallback): () => void {
    this.frameReleasedListeners.push(callback);
    return () => {
      this.frameReleasedListeners = this.frameReleasedListeners.filter((listener) => listener !== callback);
    };
  }

  flushBlackoutAndDestroy(target?: NdiOutputName, options?: BlackoutFlushOptions): void {
    if (this.destroyed || this.teardownStarted) return;
    try {
      this.send({ type: 'flushBlackout', options: { ...options, target } });
    } catch (error) {
      console.error('[NdiServiceProxy] Failed to dispatch blackout:', error);
    }
    if (target) {
      this.cachedOutputState = { ...this.cachedOutputState, [target]: false };
    }
  }

  destroy(): void {
    if (this.destroyed || this.teardownStarted) return;
    this.teardownStarted = true;
    // Best-effort blackout before tearing the host down. Use the fast budget —
    // teardown can be triggered from `before-quit` and we cannot block app
    // exit longer than the user's window-close grace period.
    try {
      this.postToHost({ type: 'flushBlackout', options: { totalBudgetMs: 500 } });
    } catch {
      // ignore — proceed to destroy
    }
    try {
      this.postToHost({ type: 'destroy' });
    } catch {
      // ignore — fallback timer below will still kill the host
    }
    this.stateChangeListeners = [];
    this.diagnosticsChangeListeners = [];
    this.frameReleasedListeners = [];
    this.teardownTimer = setTimeout(() => {
      this.finishDestroy();
    }, TEARDOWN_ACK_TIMEOUT_MS);
  }

  private send(cmd: NdiHostCommand): void {
    if (this.destroyed || this.teardownStarted) return;
    this.postToHost(cmd);
  }

  private postToHost(cmd: NdiHostCommand): void {
    this.host.postMessage(cmd);
  }

  private handleHostEvent(event: NdiHostEvent): void {
    if (event.type === 'teardownComplete') {
      this.finishDestroy();
      return;
    }
    if ((this.destroyed || this.teardownStarted) && event.type !== 'frameReleased') return;
    switch (event.type) {
      case 'ready':
        this.gpuTransport = event.gpuTransport ?? null;
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
      case 'frameReleased': {
        const pending = event.release.attemptId ? this.gpuPending.get(event.release.attemptId) : undefined;
        if (pending) {
          clearTimeout(pending.timer);
          this.gpuPending.delete(event.release.attemptId!);
          if (event.release.accepted && event.release.gpuFrameResult) pending.resolve(event.release.gpuFrameResult);
          else pending.reject(new Error(`NDI GPU frame rejected: ${event.release.reason}`));
        }
        for (const listener of this.frameReleasedListeners) listener(event.release);
        break;
      }
    }
  }

  private finishDestroy(): void {
    if (this.hostKilled) return;
    this.hostKilled = true;
    this.destroyed = true;
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    try {
      this.host.kill();
    } catch (error) {
      console.error('[NdiServiceProxy] Error killing host:', error);
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
    availabilityDrops: {
      audience: { outputDisabled: 0, senderUnavailable: 0 },
      stage: { outputDisabled: 0, senderUnavailable: 0 },
    },
    sourceStatus: 'idle',
    lastError: null,
  };
}
