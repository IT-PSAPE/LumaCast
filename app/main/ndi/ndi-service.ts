import { performance } from 'node:perf_hooks';
import { NDI_OUTPUT_HEIGHT, NDI_OUTPUT_ORDER, NDI_OUTPUT_WIDTH } from '@core/ndi';
import type {
  NdiActiveSenderDiagnostics,
  NdiDiagnostics,
  NdiFrameTelemetry,
  NdiOutputConfig,
  NdiOutputConfigMap,
  NdiOutputName,
  NdiOutputState,
  NdiSenderPerformanceDiagnostics,
  NdiSourceStatus,
} from '@core/types';
import { defaultNdiModuleLoader, type NdiNativeModule } from './ndi-native-module';

const HEARTBEAT_INTERVAL_MS = Math.round(1000 / 30);
const HEARTBEAT_STALL_THRESHOLD_MS = HEARTBEAT_INTERVAL_MS * 2;
const DIAGNOSTICS_EMIT_INTERVAL_MS = 250;
const BYTES_PER_PIXEL = 4;
const MAX_FRAME_BYTES = NDI_OUTPUT_WIDTH * NDI_OUTPUT_HEIGHT * BYTES_PER_PIXEL;
const ROLLING_AVERAGE_WINDOW = 60;

type StateChangeCallback = (state: NdiOutputState) => void;
type DiagnosticsChangeCallback = (diagnostics: NdiDiagnostics) => void;

interface NdiServiceOptions {
  outputConfigs: NdiOutputConfigMap;
  onOutputConfigsChanged: (configs: NdiOutputConfigMap) => void;
  moduleLoader?: () => NdiNativeModule;
}

interface SenderState {
  diagnostics: NdiActiveSenderDiagnostics;
  outputName: NdiOutputName;
  lastFrame: Uint8Array | null;
  lastFrameWidth: number;
  lastFrameHeight: number;
  lastFrameReceivedAt: number;
  captureDurationRolling: RollingAverage;
  readbackDurationRolling: RollingAverage;
  sendDurationRolling: RollingAverage;
}

class RollingAverage {
  private samples: number[] = [];
  private sum = 0;
  private writeIndex = 0;

  constructor(private readonly windowSize: number = ROLLING_AVERAGE_WINDOW) {}

  push(value: number): number {
    if (!Number.isFinite(value) || value < 0) return this.value;
    if (this.samples.length < this.windowSize) {
      this.samples.push(value);
      this.sum += value;
    } else {
      this.sum += value - this.samples[this.writeIndex];
      this.samples[this.writeIndex] = value;
      this.writeIndex = (this.writeIndex + 1) % this.windowSize;
    }
    return this.value;
  }

  get value(): number {
    return this.samples.length === 0 ? 0 : this.sum / this.samples.length;
  }
}

export class NdiService {
  private module: NdiNativeModule | null = null;
  private runtimeLoaded = false;
  private runtimePath: string | null = null;
  private asyncVideoSend = false;
  private outputState: NdiOutputState = { audience: false, stage: false };
  private outputConfigs: NdiOutputConfigMap;
  private onOutputConfigsChanged: (configs: NdiOutputConfigMap) => void;
  private moduleLoader: () => NdiNativeModule;
  private senders: Map<NdiOutputName, SenderState> = new Map();
  private sourceStatus: NdiSourceStatus = 'idle';
  private lastError: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private diagnosticsTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDiagnosticsEmitAt = 0;
  private destroyed = false;

  private stateChangeListeners: StateChangeCallback[] = [];
  private diagnosticsChangeListeners: DiagnosticsChangeCallback[] = [];

  constructor(options: NdiServiceOptions) {
    this.outputConfigs = options.outputConfigs;
    this.onOutputConfigsChanged = options.onOutputConfigsChanged;
    this.moduleLoader = options.moduleLoader ?? defaultNdiModuleLoader;
  }

  getOutputState(): NdiOutputState {
    return { ...this.outputState };
  }

  getOutputConfigs(): NdiOutputConfigMap {
    return { ...this.outputConfigs };
  }

  setOutputEnabled(name: NdiOutputName, enabled: boolean): NdiOutputState {
    this.outputState[name] = enabled;

    if (enabled) {
      this.rebuildActiveSenders();
      this.startHeartbeat();
    } else {
      this.destroySenderForOutput(name);
      this.rebuildActiveSenders();
      if (this.allOutputsDisabled()) {
        this.stopHeartbeat();
        this.sourceStatus = 'idle';
      }
    }

    this.emitStateChange();
    this.emitDiagnosticsChange();
    return this.getOutputState();
  }

  updateOutputConfig(name: NdiOutputName, config: Partial<NdiOutputConfig>): NdiOutputConfigMap {
    const current = this.outputConfigs[name];
    const updated = { ...current, ...config };
    this.outputConfigs = { ...this.outputConfigs, [name]: updated };
    this.onOutputConfigsChanged(this.outputConfigs);

    if (this.outputState[name]) {
      this.rebuildActiveSenders();
    }

    this.emitDiagnosticsChange();
    return this.getOutputConfigs();
  }

  receiveFrame(name: NdiOutputName, rgba: Uint8Array, width: number, height: number, telemetry?: NdiFrameTelemetry): void {
    if (this.destroyed) return;
    if (!this.outputState[name]) return;

    const sender = this.senders.get(name);
    if (!sender) return;

    if (!this.isValidFramePayload(rgba, width, height)) {
      sender.diagnostics.performance.framesRejected += 1;
      this.lastError = `Rejected invalid NDI frame for ${name}`;
      this.queueDiagnosticsEmit();
      return;
    }

    sender.diagnostics.performance.framesCaptured += 1;
    sender.diagnostics.performance.bytesReceived += rgba.byteLength;
    sender.diagnostics.performance.lastFrameBytes = rgba.byteLength;

    if (telemetry) {
      sender.diagnostics.performance.skippedCaptures += telemetry.skippedCaptures;
      sender.diagnostics.performance.framesDroppedBackpressure += telemetry.framesDroppedBackpressure;
      sender.diagnostics.performance.avgCaptureDurationMs = sender.captureDurationRolling.push(telemetry.captureDurationMs);
      sender.diagnostics.performance.avgReadbackDurationMs = sender.readbackDurationRolling.push(telemetry.readbackDurationMs);
    }

    sender.lastFrame = rgba;
    sender.lastFrameWidth = width;
    sender.lastFrameHeight = height;
    sender.lastFrameReceivedAt = Date.now();
    this.sourceStatus = 'live';
    this.lastError = null;

    this.sendFrame(name, rgba, width, height, false);
    this.queueDiagnosticsEmit();
  }

  setSourceStatus(status: NdiSourceStatus): void {
    if (this.sourceStatus === status) return;
    this.sourceStatus = status;
    this.emitDiagnosticsChange();
  }

  getDiagnostics(): NdiDiagnostics {
    const senderDiagnostics: Record<NdiOutputName, NdiActiveSenderDiagnostics | null> = {
      audience: this.cloneSenderDiagnosticsForOutput('audience'),
      stage: this.cloneSenderDiagnosticsForOutput('stage'),
    };
    const primaryOutput = senderDiagnostics.audience
      ? 'audience'
      : senderDiagnostics.stage
        ? 'stage'
        : this.outputState.audience
          ? 'audience'
          : 'stage';
    return {
      outputState: this.getOutputState(),
      outputConfig: { ...this.outputConfigs[primaryOutput] },
      outputConfigs: this.getOutputConfigs(),
      runtimeLoaded: this.runtimeLoaded,
      runtimePath: this.runtimePath,
      activeSender: senderDiagnostics[primaryOutput],
      senders: senderDiagnostics,
      sourceStatus: this.sourceStatus,
      lastError: this.lastError,
    };
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

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopHeartbeat();
    this.stopDiagnosticsTimer();

    try {
      this.module?.destroySender();
    } catch (error) {
      console.error('[NdiService] Error during destroy:', error);
    }

    this.senders.clear();
    this.module = null;
  }

  private allOutputsDisabled(): boolean {
    for (const name of NDI_OUTPUT_ORDER) {
      if (this.outputState[name]) return false;
    }
    return true;
  }

  private loadModuleIfNeeded(): boolean {
    if (this.module) return true;

    try {
      this.module = this.moduleLoader();
      this.refreshRuntimeInfo();
      this.lastError = null;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[NdiService] Failed to load native module:', message);
      this.lastError = message;
      this.runtimeLoaded = false;
      this.asyncVideoSend = false;
      return false;
    }
  }

  private refreshRuntimeInfo(): void {
    const info = this.module?.getRuntimeInfo?.();
    this.runtimeLoaded = info?.loaded ?? Boolean(this.module);
    this.runtimePath = info?.path ?? null;
    this.asyncVideoSend = info?.asyncVideoSend ?? false;
  }

  private ensureSender(name: NdiOutputName): void {
    if (!this.loadModuleIfNeeded()) return;
    if (this.senders.has(name)) return;

    const config = this.outputConfigs[name];
    const senderName = this.resolveSenderName(name);
    const width = NDI_OUTPUT_WIDTH;
    const height = NDI_OUTPUT_HEIGHT;

    try {
      this.module!.initializeSender({
        senderName,
        width,
        height,
        withAlpha: config.withAlpha,
      });
      this.refreshRuntimeInfo();
      this.senders.set(name, {
        diagnostics: {
          senderName,
          width,
          height,
          withAlpha: config.withAlpha,
          asyncVideoSend: this.asyncVideoSend,
          connectionCount: null,
          performance: createEmptySenderPerformanceDiagnostics(),
        },
        outputName: name,
        lastFrame: null,
        lastFrameWidth: 0,
        lastFrameHeight: 0,
        lastFrameReceivedAt: 0,
        captureDurationRolling: new RollingAverage(),
        readbackDurationRolling: new RollingAverage(),
        sendDurationRolling: new RollingAverage(),
      });
      this.lastError = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[NdiService] Failed to initialize sender:', message);
      this.lastError = message;
    }
  }

  private destroySenderForOutput(name: NdiOutputName): void {
    if (!this.module) return;
    const sender = this.senders.get(name);
    if (!sender) return;

    try {
      this.module.destroySender(sender.diagnostics.senderName);
    } catch (error) {
      console.error('[NdiService] Error destroying sender:', error);
    }

    this.senders.delete(name);
  }

  private rebuildActiveSenders(): void {
    const enabledOutputs = NDI_OUTPUT_ORDER.filter((name) => this.outputState[name]);
    const previousFrames = new Map(this.senders);

    for (const name of [...this.senders.keys()]) {
      this.destroySenderForOutput(name);
    }

    for (const name of enabledOutputs) {
      this.ensureSender(name);
      const restored = this.senders.get(name);
      const previous = previousFrames.get(name);
      if (!restored || !previous) continue;
      restored.lastFrame = previous.lastFrame ? new Uint8Array(previous.lastFrame) : null;
      restored.lastFrameWidth = previous.lastFrameWidth;
      restored.lastFrameHeight = previous.lastFrameHeight;
      restored.lastFrameReceivedAt = previous.lastFrameReceivedAt;
      restored.diagnostics.performance = { ...previous.diagnostics.performance };
      if (previous.lastFrame) {
        restored.diagnostics.performance.cacheCopyBytes += previous.lastFrame.byteLength;
      }
    }
  }

  private resolveSenderName(name: NdiOutputName): string {
    const requestedName = this.outputConfigs[name].senderName.trim();
    let duplicateCount = 0;
    for (const outputName of NDI_OUTPUT_ORDER) {
      if (!this.outputState[outputName]) continue;
      const candidate = this.outputConfigs[outputName].senderName.trim();
      if (candidate !== requestedName) continue;
      duplicateCount += 1;
      if (outputName === name) {
        break;
      }
    }

    if (duplicateCount <= 1) {
      return requestedName;
    }

    const suffix = name === 'audience' ? 'Audience' : 'Stage';
    return `${requestedName} (${suffix})`;
  }

  private isValidFramePayload(rgba: Uint8Array, width: number, height: number): boolean {
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      return false;
    }
    if (width !== NDI_OUTPUT_WIDTH || height !== NDI_OUTPUT_HEIGHT) {
      return false;
    }

    const expectedLength = width * height * BYTES_PER_PIXEL;
    if (expectedLength <= 0 || expectedLength > MAX_FRAME_BYTES) {
      return false;
    }

    return rgba.byteLength === expectedLength;
  }

  private sendFrame(name: NdiOutputName, rgba: Uint8Array, width: number, height: number, replayed: boolean): void {
    if (!this.module) return;
    const sender = this.senders.get(name);
    if (!sender) return;

    try {
      const connectionCount = this.module.getSenderConnections?.(sender.diagnostics.senderName, 0) ?? null;
      sender.diagnostics.connectionCount = typeof connectionCount === 'number' && connectionCount >= 0 ? connectionCount : null;
      const startedAt = performance.now();
      this.module.sendRgbaFrame(sender.diagnostics.senderName, rgba, width, height);
      sender.diagnostics.performance.avgSendDurationMs = sender.sendDurationRolling.push(performance.now() - startedAt);
      sender.diagnostics.performance.framesSent += 1;
      if (replayed) {
        sender.diagnostics.performance.framesReplayed += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[NdiService] Frame send failed:', message);
      this.lastError = message;
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      if (this.destroyed) return;
      const now = Date.now();
      let replayedFrame = false;

      for (const [name, sender] of this.senders) {
        if (!this.outputState[name]) continue;
        if (now - sender.lastFrameReceivedAt <= HEARTBEAT_STALL_THRESHOLD_MS) continue;
        if (sender.lastFrame) {
          this.sendFrame(name, sender.lastFrame, sender.lastFrameWidth, sender.lastFrameHeight, true);
          replayedFrame = true;
        }
      }

      if (replayedFrame) {
        this.queueDiagnosticsEmit();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private stopDiagnosticsTimer(): void {
    if (this.diagnosticsTimer) {
      clearTimeout(this.diagnosticsTimer);
      this.diagnosticsTimer = null;
    }
  }

  private emitStateChange(): void {
    const state = this.getOutputState();
    for (const listener of this.stateChangeListeners) {
      listener(state);
    }
  }

  private emitDiagnosticsChange(): void {
    this.lastDiagnosticsEmitAt = Date.now();
    this.stopDiagnosticsTimer();
    const diagnostics = this.getDiagnostics();
    for (const listener of this.diagnosticsChangeListeners) {
      listener(diagnostics);
    }
  }

  private queueDiagnosticsEmit(): void {
    const now = Date.now();
    const elapsed = now - this.lastDiagnosticsEmitAt;
    if (elapsed >= DIAGNOSTICS_EMIT_INTERVAL_MS) {
      this.emitDiagnosticsChange();
      return;
    }
    if (this.diagnosticsTimer) return;
    this.diagnosticsTimer = setTimeout(() => {
      this.diagnosticsTimer = null;
      this.emitDiagnosticsChange();
    }, DIAGNOSTICS_EMIT_INTERVAL_MS - elapsed);
  }

  private cloneSenderDiagnosticsForOutput(name: NdiOutputName): NdiActiveSenderDiagnostics | null {
    const sender = this.senders.get(name);
    return sender ? cloneSenderDiagnostics(sender.diagnostics) : null;
  }
}

function createEmptySenderPerformanceDiagnostics(): NdiSenderPerformanceDiagnostics {
  return {
    framesCaptured: 0,
    framesSent: 0,
    framesReplayed: 0,
    framesRejected: 0,
    framesSkippedNoConnections: 0,
    skippedCaptures: 0,
    framesDroppedBackpressure: 0,
    bytesReceived: 0,
    cacheCopyBytes: 0,
    avgCaptureDurationMs: 0,
    avgReadbackDurationMs: 0,
    avgSendDurationMs: 0,
    lastFrameBytes: 0,
  };
}

function cloneSenderDiagnostics(diagnostics: NdiActiveSenderDiagnostics): NdiActiveSenderDiagnostics {
  return {
    ...diagnostics,
    performance: { ...diagnostics.performance },
  };
}
