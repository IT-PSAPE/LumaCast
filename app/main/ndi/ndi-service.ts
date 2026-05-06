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
  NdiSenderAudioDiagnostics,
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
// Send-duration sample window — sized to fit ~2s of 30 fps so percentiles
// reflect recent behavior, not lifetime stats.
const SEND_LATENCY_SAMPLE_WINDOW = 64;

// Hard caps for audio frames, applied before handing the buffer to the
// native sender. These are loose enough for any sane Web Audio source but
// catch corrupt payloads (e.g. mis-sized buffers from a malicious renderer).
const MAX_AUDIO_CHANNELS = 32;
const MAX_AUDIO_SAMPLES_PER_CHANNEL = 192000; // 1 second at 192 kHz
const MAX_AUDIO_SAMPLE_RATE = 192000;

// Blackout burst defaults — receivers see a clean fade to black/silence
// before signal drop instead of a frozen last frame.
const DEFAULT_BLACKOUT_FRAME_COUNT = 15;
const DEFAULT_BLACKOUT_INTERVAL_MS = 1000 / 30;
const DEFAULT_BLACKOUT_TOTAL_BUDGET_MS = 750;
const FAST_BLACKOUT_TOTAL_BUDGET_MS = 250;
const BLACKOUT_AUDIO_SAMPLE_RATE = 48000;
const BLACKOUT_AUDIO_CHANNELS = 2;
const BLACKOUT_AUDIO_SAMPLES_PER_CHANNEL = 1024;

type StateChangeCallback = (state: NdiOutputState) => void;
type DiagnosticsChangeCallback = (diagnostics: NdiDiagnostics) => void;

interface NdiServiceOptions {
  outputConfigs: NdiOutputConfigMap;
  onOutputConfigsChanged: (configs: NdiOutputConfigMap) => void;
  moduleLoader?: () => NdiNativeModule;
}

export interface BlackoutOptions {
  frameCount?: number;
  intervalMs?: number;
  totalBudgetMs?: number;
  destroy?: boolean;
}

interface SenderState {
  diagnostics: NdiActiveSenderDiagnostics;
  outputName: NdiOutputName;
  lastFrame: Uint8Array | null;
  lastFrameWidth: number;
  lastFrameHeight: number;
  lastFrameReceivedAt: number;
  lastSendAt: number;
  captureDurationRolling: RollingAverage;
  readbackDurationRolling: RollingAverage;
  sendDurationRolling: RollingAverage;
  sendDurationSamples: RollingSampleBuffer;
  sendIntervalSamples: RollingSampleBuffer;
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

// Plain ring buffer of recent samples — used for percentile + jitter
// calculations that need access to all recent values, not just an average.
class RollingSampleBuffer {
  private readonly buffer: number[] = [];
  private writeIndex = 0;

  constructor(private readonly windowSize: number) {}

  push(value: number): void {
    if (!Number.isFinite(value)) return;
    if (this.buffer.length < this.windowSize) {
      this.buffer.push(value);
    } else {
      this.buffer[this.writeIndex] = value;
      this.writeIndex = (this.writeIndex + 1) % this.windowSize;
    }
  }

  snapshot(): number[] {
    return this.buffer.slice();
  }

  get size(): number {
    return this.buffer.length;
  }
}

function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const idx = Math.min(
    sortedAscending.length - 1,
    Math.floor((p / 100) * sortedAscending.length),
  );
  return sortedAscending[idx];
}

function standardDeviation(samples: number[]): number {
  if (samples.length < 2) return 0;
  let sum = 0;
  for (const v of samples) sum += v;
  const mean = sum / samples.length;
  let varianceSum = 0;
  for (const v of samples) {
    const d = v - mean;
    varianceSum += d * d;
  }
  return Math.sqrt(varianceSum / samples.length);
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
  // Reusable buffers for blackout frames — allocated once on first flush so
  // every controlled-shutdown path can fire even when allocations are
  // restricted (e.g. inside an unhandledRejection handler).
  private blackoutVideoFrame: Uint8Array | null = null;
  private blackoutAudioFrame: Float32Array | null = null;

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
      // Run a blackout burst before destroying so receivers see a clean
      // visual cutoff. Synchronous so callers can rely on the sender being
      // gone when this returns (subject to the budget timeout).
      this.flushBlackoutAndDestroy(name);
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

    const performanceData = sender.diagnostics.performance;
    performanceData.framesCaptured += 1;
    performanceData.bytesReceived += rgba.byteLength;
    performanceData.lastFrameBytes = rgba.byteLength;
    if (performanceData.minFrameBytes === 0 || rgba.byteLength < performanceData.minFrameBytes) {
      performanceData.minFrameBytes = rgba.byteLength;
    }
    if (rgba.byteLength > performanceData.maxFrameBytes) {
      performanceData.maxFrameBytes = rgba.byteLength;
    }

    if (telemetry) {
      performanceData.skippedCaptures += telemetry.skippedCaptures;
      performanceData.framesDroppedBackpressure += telemetry.framesDroppedBackpressure;
      performanceData.avgCaptureDurationMs = sender.captureDurationRolling.push(telemetry.captureDurationMs);
      performanceData.avgReadbackDurationMs = sender.readbackDurationRolling.push(telemetry.readbackDurationMs);
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

  receiveAudioFrame(
    name: NdiOutputName,
    samples: Float32Array,
    sampleRate: number,
    channels: number,
    samplesPerChannel: number,
  ): void {
    if (this.destroyed) return;
    if (!this.outputState[name]) return;

    const sender = this.senders.get(name);
    if (!sender) return;

    if (!this.isValidAudioPayload(samples, sampleRate, channels, samplesPerChannel)) {
      sender.diagnostics.audio.audioFramesRejected += 1;
      this.lastError = `Rejected invalid NDI audio frame for ${name}`;
      this.queueDiagnosticsEmit();
      return;
    }

    sender.diagnostics.audio.audioFramesReceived += 1;
    sender.diagnostics.audio.lastSampleRate = sampleRate;
    sender.diagnostics.audio.lastChannels = channels;

    if (!this.module) return;
    const sendAudio = this.module.sendAudioFrame;
    if (!sendAudio) {
      // Native runtime doesn't support audio (older NDI lib). Drop silently —
      // diagnostics will show frames received but not sent.
      this.queueDiagnosticsEmit();
      return;
    }

    try {
      sendAudio(sender.diagnostics.senderName, samples, sampleRate, channels, samplesPerChannel);
      sender.diagnostics.audio.audioFramesSent += 1;
      sender.diagnostics.audio.audioSamplesSent += samplesPerChannel;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[NdiService] Audio frame send failed:', message);
      this.lastError = message;
    }

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

  // Sends a brief black-video + silent-audio burst to one or all senders so
  // receivers get a clean visual cutoff before signal loss, then destroys
  // the sender(s). Bounded by `totalBudgetMs` so a stuck native call cannot
  // hang process exit. Safe to call multiple times.
  flushBlackoutAndDestroy(target?: NdiOutputName, opts?: BlackoutOptions): void {
    if (this.destroyed) return;
    const targets = target ? [target] : NDI_OUTPUT_ORDER.filter((name) => this.senders.has(name));
    if (targets.length === 0) return;

    const frameCount = opts?.frameCount ?? DEFAULT_BLACKOUT_FRAME_COUNT;
    const intervalMs = opts?.intervalMs ?? DEFAULT_BLACKOUT_INTERVAL_MS;
    const totalBudgetMs = opts?.totalBudgetMs ?? DEFAULT_BLACKOUT_TOTAL_BUDGET_MS;
    const destroyAfter = opts?.destroy ?? true;

    // Stop heartbeat first — otherwise the timer would resurrect the
    // pre-blackout frame on the next tick.
    this.stopHeartbeat();

    const startedAt = performance.now();
    for (const name of targets) {
      const sender = this.senders.get(name);
      if (!sender) continue;

      const opaqueBlack = !sender.diagnostics.withAlpha;
      const videoFrame = this.getOrCreateBlackoutVideoFrame(opaqueBlack);
      const audioFrame = this.getOrCreateBlackoutAudioFrame();

      for (let i = 0; i < frameCount; i++) {
        if (performance.now() - startedAt > totalBudgetMs) break;
        try {
          this.module?.sendRgbaFrame(sender.diagnostics.senderName, videoFrame, sender.diagnostics.width, sender.diagnostics.height);
          sender.diagnostics.performance.blackoutFramesSent += 1;
          sender.diagnostics.performance.framesSent += 1;
        } catch (error) {
          // Native binding gone — abort the burst for this sender.
          console.error('[NdiService] Blackout video send failed:', error);
          break;
        }
        const sendAudio = this.module?.sendAudioFrame;
        if (sendAudio) {
          try {
            sendAudio(
              sender.diagnostics.senderName,
              audioFrame,
              BLACKOUT_AUDIO_SAMPLE_RATE,
              BLACKOUT_AUDIO_CHANNELS,
              BLACKOUT_AUDIO_SAMPLES_PER_CHANNEL,
            );
            sender.diagnostics.audio.audioSilenceFramesSent += 1;
            sender.diagnostics.audio.audioFramesSent += 1;
          } catch (error) {
            console.error('[NdiService] Blackout audio send failed:', error);
          }
        }

        if (i < frameCount - 1 && intervalMs > 0) {
          this.busyWait(intervalMs);
        }
      }
    }

    if (destroyAfter) {
      for (const name of targets) {
        this.destroySenderForOutput(name);
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    // Last-chance blackout for any sender we still have open — this handles
    // the case where teardown was reached without an explicit
    // flushBlackoutAndDestroy call (legacy callers, signal handlers).
    if (this.senders.size > 0) {
      try {
        this.flushBlackoutAndDestroy(undefined, { destroy: false });
      } catch (error) {
        console.error('[NdiService] Final blackout failed:', error);
      }
    }

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
      console.log(`[NdiService] Sender created`, JSON.stringify({ output: name, senderName, width, height, withAlpha: config.withAlpha }));
      this.senders.set(name, {
        diagnostics: {
          senderName,
          width,
          height,
          withAlpha: config.withAlpha,
          asyncVideoSend: this.asyncVideoSend,
          connectionCount: null,
          startedAtMs: Date.now(),
          performance: createEmptySenderPerformanceDiagnostics(),
          audio: createEmptySenderAudioDiagnostics(),
        },
        outputName: name,
        lastFrame: null,
        lastFrameWidth: 0,
        lastFrameHeight: 0,
        lastFrameReceivedAt: 0,
        lastSendAt: 0,
        captureDurationRolling: new RollingAverage(),
        readbackDurationRolling: new RollingAverage(),
        sendDurationRolling: new RollingAverage(),
        sendDurationSamples: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
        sendIntervalSamples: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
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

    console.log(`[NdiService] Sender destroyed`, JSON.stringify({
      output: name,
      senderName: sender.diagnostics.senderName,
      uptimeMs: Date.now() - sender.diagnostics.startedAtMs,
      framesSent: sender.diagnostics.performance.framesSent,
      blackoutFramesSent: sender.diagnostics.performance.blackoutFramesSent,
    }));
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
      restored.diagnostics.audio = { ...previous.diagnostics.audio };
      restored.diagnostics.startedAtMs = previous.diagnostics.startedAtMs;
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

  private isValidAudioPayload(
    samples: Float32Array,
    sampleRate: number,
    channels: number,
    samplesPerChannel: number,
  ): boolean {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > MAX_AUDIO_SAMPLE_RATE) return false;
    if (!Number.isInteger(channels) || channels <= 0 || channels > MAX_AUDIO_CHANNELS) return false;
    if (!Number.isInteger(samplesPerChannel) || samplesPerChannel <= 0 || samplesPerChannel > MAX_AUDIO_SAMPLES_PER_CHANNEL) return false;
    return samples.length >= channels * samplesPerChannel;
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
      const duration = performance.now() - startedAt;
      sender.diagnostics.performance.avgSendDurationMs = sender.sendDurationRolling.push(duration);
      sender.sendDurationSamples.push(duration);
      if (sender.lastSendAt > 0) {
        sender.sendIntervalSamples.push(startedAt - sender.lastSendAt);
      }
      sender.lastSendAt = startedAt;

      const sortedDurations = sender.sendDurationSamples.snapshot().sort((a, b) => a - b);
      sender.diagnostics.performance.p50SendDurationMs = percentile(sortedDurations, 50);
      sender.diagnostics.performance.p95SendDurationMs = percentile(sortedDurations, 95);
      sender.diagnostics.performance.p99SendDurationMs = percentile(sortedDurations, 99);
      sender.diagnostics.performance.sendIntervalJitterMs = standardDeviation(
        sender.sendIntervalSamples.snapshot(),
      );

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

  private getOrCreateBlackoutVideoFrame(opaque: boolean): Uint8Array {
    if (!this.blackoutVideoFrame || this.blackoutVideoFrame.length !== MAX_FRAME_BYTES) {
      this.blackoutVideoFrame = new Uint8Array(MAX_FRAME_BYTES);
    }
    // Black with appropriate alpha. For non-alpha senders we fill the alpha
    // byte so receivers showing alpha treat the frame as fully opaque.
    if (opaque) {
      const buf = this.blackoutVideoFrame;
      for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    } else {
      this.blackoutVideoFrame.fill(0);
    }
    return this.blackoutVideoFrame;
  }

  private getOrCreateBlackoutAudioFrame(): Float32Array {
    const required = BLACKOUT_AUDIO_CHANNELS * BLACKOUT_AUDIO_SAMPLES_PER_CHANNEL;
    if (!this.blackoutAudioFrame || this.blackoutAudioFrame.length !== required) {
      this.blackoutAudioFrame = new Float32Array(required);
    }
    return this.blackoutAudioFrame;
  }

  private busyWait(ms: number): void {
    // Synchronous wait — required because shutdown handlers run on a path
    // where async work isn't guaranteed to complete (process.exit fires on
    // the next tick). A 33 ms spin every blackout frame is acceptable: the
    // app is going down anyway and the budget caps total time.
    const target = performance.now() + ms;
    while (performance.now() < target) {
      // Intentional empty loop — see comment above.
    }
  }
}

export const NDI_FAST_BLACKOUT_BUDGET_MS = FAST_BLACKOUT_TOTAL_BUDGET_MS;

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
    p50SendDurationMs: 0,
    p95SendDurationMs: 0,
    p99SendDurationMs: 0,
    sendIntervalJitterMs: 0,
    lastFrameBytes: 0,
    minFrameBytes: 0,
    maxFrameBytes: 0,
    blackoutFramesSent: 0,
  };
}

function createEmptySenderAudioDiagnostics(): NdiSenderAudioDiagnostics {
  return {
    audioFramesReceived: 0,
    audioFramesSent: 0,
    audioFramesRejected: 0,
    audioSamplesSent: 0,
    audioSilenceFramesSent: 0,
    lastSampleRate: 0,
    lastChannels: 0,
  };
}

function cloneSenderDiagnostics(diagnostics: NdiActiveSenderDiagnostics): NdiActiveSenderDiagnostics {
  return {
    ...diagnostics,
    performance: { ...diagnostics.performance },
    audio: { ...diagnostics.audio },
  };
}
