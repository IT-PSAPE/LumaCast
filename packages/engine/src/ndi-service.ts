import { performance } from 'node:perf_hooks';
import {
  NDI_OUTPUT_HEIGHT,
  NDI_OUTPUT_ORDER,
  NDI_OUTPUT_WIDTH,
  NDI_VIDEO_FRAME_INTERVAL_MS,
  sanitizeNdiFrameTelemetry,
} from '@lumacast/protocol';
import type {
  NdiActiveSenderDiagnostics,
  NdiDiagnostics,
  NdiFrameDropReason,
  NdiFrameDropReasonCounts,
  NdiFrameRelease,
  NdiFrameReleaseReason,
  NdiFrameTelemetry,
  NdiOutputConfig,
  NdiOutputAvailabilityDropCounts,
  NdiOutputConfigMap,
  NdiOutputName,
  NdiOutputState,
  NdiTakeReason,
  NdiPipelineLatencyDiagnostics,
  NdiPipelineStageStats,
  NdiSenderAudioDiagnostics,
  NdiSenderPerformanceDiagnostics,
  NdiSourceStatus,
} from '@lumacast/protocol';
import { defaultNdiModuleLoader, type NdiNativeModule } from './ndi-native-module';

const HEARTBEAT_INTERVAL_MS = NDI_VIDEO_FRAME_INTERVAL_MS;
const HEARTBEAT_STALL_THRESHOLD_MS = HEARTBEAT_INTERVAL_MS * 2;
const DIAGNOSTICS_EMIT_INTERVAL_MS = 250;
const BYTES_PER_PIXEL = 4;
const MAX_FRAME_BYTES = NDI_OUTPUT_WIDTH * NDI_OUTPUT_HEIGHT * BYTES_PER_PIXEL;
const ROLLING_AVERAGE_WINDOW = 60;
const MAX_TELEMETRY_COUNT = Number.MAX_SAFE_INTEGER;
const MAX_PIPELINE_SPAN_MS = 60_000;
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
type FrameReleasedCallback = (release: NdiFrameRelease) => void;

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

interface PipelineSampleBuffers {
  frameAgeAtNativeSend: RollingSampleBuffer;
  signatureToNativeSend: RollingSampleBuffer;
  activateToNativeSend: RollingSampleBuffer;
  takeToNativeSend: RollingSampleBuffer;
  takeReasonToNativeSend: Record<NdiTakeReason, RollingSampleBuffer>;
  captureToRendererSend: RollingSampleBuffer;
  rendererToMainIpc: RollingSampleBuffer;
  mainHandler: RollingSampleBuffer;
  mainToHostIpc: RollingSampleBuffer;
  directWorkerToHostIpc: RollingSampleBuffer;
  hostToNative: RollingSampleBuffer;
}

interface PipelineLastSamples {
  frameAgeAtNativeSend: number;
  signatureToNativeSend: number;
  activateToNativeSend: number;
  takeToNativeSend: number;
  takeReasonToNativeSend: Record<NdiTakeReason, number>;
  captureToRendererSend: number;
  rendererToMainIpc: number;
  mainHandler: number;
  mainToHostIpc: number;
  directWorkerToHostIpc: number;
  hostToNative: number;
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
  pipelineSamples: PipelineSampleBuffers;
  pipelineLastSamples: PipelineLastSamples;
  acceptedTakeKeys: string[];
  acceptedTakeKeySet: Set<string>;
}

interface AcceptedCorrelationAggregation {
  kind: 'activate' | 'take';
  reason: NdiTakeReason;
  spanMs: number;
  takeKey: string;
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
  private availabilityDrops: Record<NdiOutputName, NdiOutputAvailabilityDropCounts> = {
    audience: { outputDisabled: 0, senderUnavailable: 0 },
    stage: { outputDisabled: 0, senderUnavailable: 0 },
  };
  private onOutputConfigsChanged: (configs: NdiOutputConfigMap) => void;
  private moduleLoader: () => NdiNativeModule;
  private senders: Map<NdiOutputName, SenderState> = new Map();
  private sourceStatus: NdiSourceStatus = 'idle';
  private lastError: string | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatDeadlineMs = 0;
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
  private frameReleasedListeners: FrameReleasedCallback[] = [];

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
    const sanitizedTelemetry = sanitizeNdiFrameTelemetry(telemetry);
    if (this.destroyed) {
      this.availabilityDrops[name].senderUnavailable += 1;
      this.queueDiagnosticsEmit();
      this.emitFrameReleased({
        name,
        attemptId: sanitizedTelemetry?.attemptId,
        accepted: false,
        reason: 'senderUnavailable',
        releasedAtMs: Date.now(),
      });
      return;
    }
    if (!this.outputState[name]) {
      this.availabilityDrops[name].outputDisabled += 1;
      this.queueDiagnosticsEmit();
      this.emitFrameReleased({
        name,
        attemptId: sanitizedTelemetry?.attemptId,
        accepted: false,
        reason: 'outputDisabled',
        releasedAtMs: Date.now(),
      });
      return;
    }

    const sender = this.senders.get(name);
    if (!sender) {
      this.availabilityDrops[name].senderUnavailable += 1;
      this.queueDiagnosticsEmit();
      this.emitFrameReleased({
        name,
        attemptId: sanitizedTelemetry?.attemptId,
        accepted: false,
        reason: 'senderUnavailable',
        releasedAtMs: Date.now(),
      });
      return;
    }

    if (!this.isValidFramePayload(rgba, width, height)) {
      sender.diagnostics.performance.framesRejected += 1;
      sender.diagnostics.performance.frameDrops.invalidPayload += 1;
      this.lastError = `Rejected invalid NDI frame for ${name}`;
      this.queueDiagnosticsEmit();
      this.emitFrameReleased({
        name,
        attemptId: sanitizedTelemetry?.attemptId,
        accepted: false,
        reason: 'invalidPayload',
        releasedAtMs: Date.now(),
      });
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

    if (sanitizedTelemetry) {
      performanceData.skippedCaptures = saturatingAddInt(
        performanceData.skippedCaptures,
        sanitizedTelemetry.skippedCaptures,
      );
      performanceData.framesDroppedBackpressure = saturatingAddInt(
        performanceData.framesDroppedBackpressure,
        sanitizedTelemetry.framesDroppedBackpressure,
      );
      performanceData.correctiveFrameRetries = saturatingAddInt(
        performanceData.correctiveFrameRetries,
        sanitizedTelemetry.correctiveFrameRetries,
      );
      mergeFrameDropReasons(performanceData.frameDrops, sanitizedTelemetry.dropReasons);
      performanceData.avgCaptureDurationMs = sender.captureDurationRolling.push(sanitizedTelemetry.captureDurationMs);
      performanceData.avgReadbackDurationMs = sender.readbackDurationRolling.push(sanitizedTelemetry.readbackDurationMs);
    }

    sender.lastFrame = rgba;
    sender.lastFrameWidth = width;
    sender.lastFrameHeight = height;
    sender.lastFrameReceivedAt = Date.now();
    this.sourceStatus = 'live';
    this.lastError = null;

    const sendReason = this.sendFrame(name, rgba, width, height, false, sanitizedTelemetry);
    this.queueDiagnosticsEmit();
    this.emitFrameReleased({
      name,
      attemptId: sanitizedTelemetry?.attemptId,
      accepted: sendReason === 'sent',
      reason: sendReason,
      releasedAtMs: Date.now(),
    });
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
      availabilityDrops: {
        audience: { ...this.availabilityDrops.audience },
        stage: { ...this.availabilityDrops.stage },
      },
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

  onFrameReleased(callback: FrameReleasedCallback): () => void {
    this.frameReleasedListeners.push(callback);
    return () => {
      this.frameReleasedListeners = this.frameReleasedListeners.filter((listener) => listener !== callback);
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
          tally: null,
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
        pipelineSamples: {
          frameAgeAtNativeSend: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
          signatureToNativeSend: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
          activateToNativeSend: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
          takeToNativeSend: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
          takeReasonToNativeSend: {
            sequential: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
            jump: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
            crossItem: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
            macro: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
          },
          captureToRendererSend: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
          rendererToMainIpc: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
          mainHandler: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
          mainToHostIpc: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
          directWorkerToHostIpc: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
          hostToNative: new RollingSampleBuffer(SEND_LATENCY_SAMPLE_WINDOW),
        },
        pipelineLastSamples: createEmptyPipelineLastSamples(),
        acceptedTakeKeys: [],
        acceptedTakeKeySet: new Set(),
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
      restored.diagnostics.performance = cloneSenderPerformance(previous.diagnostics.performance);
      restored.diagnostics.audio = { ...previous.diagnostics.audio };
      restored.diagnostics.startedAtMs = previous.diagnostics.startedAtMs;
      restored.acceptedTakeKeys = previous.acceptedTakeKeys.slice();
      restored.acceptedTakeKeySet = new Set(previous.acceptedTakeKeySet);
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

  private sendFrame(
    name: NdiOutputName,
    rgba: Uint8Array,
    width: number,
    height: number,
    replayed: boolean,
    telemetry?: NdiFrameTelemetry,
  ): NdiFrameReleaseReason {
    if (!this.module) {
      this.availabilityDrops[name].senderUnavailable += 1;
      return 'senderUnavailable';
    }
    const sender = this.senders.get(name);
    if (!sender) {
      this.availabilityDrops[name].senderUnavailable += 1;
      return 'senderUnavailable';
    }

    try {
      const connectionCount = this.module.getSenderConnections?.(sender.diagnostics.senderName, 0) ?? null;
      sender.diagnostics.connectionCount = typeof connectionCount === 'number' && connectionCount >= 0 ? connectionCount : null;
      const tally = this.module.getSenderTally?.(sender.diagnostics.senderName, 0) ?? null;
      sender.diagnostics.tally = tally && typeof tally === 'object' && 'onProgram' in tally && 'onPreview' in tally
        ? { onProgram: !!tally.onProgram, onPreview: !!tally.onPreview }
        : null;
      const startedAt = performance.now();
      this.module.sendRgbaFrame(sender.diagnostics.senderName, rgba, width, height);
      const duration = performance.now() - startedAt;
      const nativeSentAtMs = Date.now();
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

      if (telemetry && !replayed) {
        const acceptedCorrelation = planAcceptedCorrelationAggregation(sender, telemetry, nativeSentAtMs);
        recordPipelineSpans(
          sender,
          telemetry,
          nativeSentAtMs,
          acceptedCorrelation,
        );
      }
      return 'sent';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[NdiService] Frame send failed:', message);
      this.lastError = message;
      sender.diagnostics.performance.frameDrops.nativeSendFailed += 1;
      return 'nativeSendFailed';
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatDeadlineMs = performance.now() + HEARTBEAT_INTERVAL_MS;
    const scheduleNextHeartbeat = () => {
      const delayMs = Math.max(0, this.heartbeatDeadlineMs - performance.now());
      this.heartbeatTimer = setTimeout(() => {
        this.heartbeatTimer = null;
        this.heartbeatDeadlineMs += HEARTBEAT_INTERVAL_MS;
        const currentPerfMs = performance.now();
        while (this.heartbeatDeadlineMs <= currentPerfMs) {
          this.heartbeatDeadlineMs += HEARTBEAT_INTERVAL_MS;
        }
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
        scheduleNextHeartbeat();
      }, delayMs);
    };
    scheduleNextHeartbeat();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
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

  private emitFrameReleased(release: NdiFrameRelease): void {
    for (const listener of this.frameReleasedListeners) {
      listener(release);
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
    skippedCaptures: 0,
    framesDroppedBackpressure: 0,
    correctiveFrameRetries: 0,
    frameDrops: createEmptyFrameDropReasons(),
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
    pipeline: createEmptyPipelineLatency(),
  };
}

function createEmptyPipelineStageStats(): NdiPipelineStageStats {
  return { p50: 0, p95: 0, lastMs: 0, count: 0 };
}

function createEmptyPipelineLatency(): NdiPipelineLatencyDiagnostics {
  return {
    frameAgeAtNativeSend: createEmptyPipelineStageStats(),
    signatureToNativeSend: createEmptyPipelineStageStats(),
    activateToNativeSend: createEmptyPipelineStageStats(),
    takeToNativeSend: createEmptyPipelineStageStats(),
    takeReasonToNativeSend: {
      sequential: createEmptyPipelineStageStats(),
      jump: createEmptyPipelineStageStats(),
      crossItem: createEmptyPipelineStageStats(),
      macro: createEmptyPipelineStageStats(),
    },
    captureToRendererSend: createEmptyPipelineStageStats(),
    rendererToMainIpc: createEmptyPipelineStageStats(),
    mainHandler: createEmptyPipelineStageStats(),
    mainToHostIpc: createEmptyPipelineStageStats(),
    directWorkerToHostIpc: createEmptyPipelineStageStats(),
    hostToNative: createEmptyPipelineStageStats(),
  };
}

function createEmptyPipelineLastSamples(): PipelineLastSamples {
  return {
    frameAgeAtNativeSend: 0,
    signatureToNativeSend: 0,
    activateToNativeSend: 0,
    takeToNativeSend: 0,
    takeReasonToNativeSend: {
      sequential: 0,
      jump: 0,
      crossItem: 0,
      macro: 0,
    },
    captureToRendererSend: 0,
    rendererToMainIpc: 0,
    mainHandler: 0,
    mainToHostIpc: 0,
    directWorkerToHostIpc: 0,
    hostToNative: 0,
  };
}

function createEmptyFrameDropReasons(): NdiFrameDropReasonCounts {
  return {
    backpressure: 0,
    ackTimeout: 0,
    captureFailed: 0,
    bitmapFailed: 0,
    invalidPayload: 0,
    outputDisabled: 0,
    senderUnavailable: 0,
    nativeSendFailed: 0,
  };
}

function mergeFrameDropReasons(
  target: NdiFrameDropReasonCounts,
  source: Partial<NdiFrameDropReasonCounts> | undefined,
): void {
  if (!source) return;
  for (const reason of Object.keys(source) as NdiFrameDropReason[]) {
    const next = source[reason];
    if (!Number.isSafeInteger(next) || typeof next !== 'number' || next <= 0) continue;
    target[reason] = saturatingAddInt(target[reason], next);
  }
}

// Record a sample only when the span is non-negative — clock skew between
// processes (Date.now() reordering on resume, NTP step) can produce
// nonsensical negatives that would skew percentiles.
function pushSpan(buffer: RollingSampleBuffer, valueMs: number): number | null {
  if (!Number.isFinite(valueMs) || valueMs < 0 || valueMs > MAX_PIPELINE_SPAN_MS) return null;
  buffer.push(valueMs);
  return valueMs;
}

function saturatingAddInt(current: number, next: number): number {
  if (!Number.isSafeInteger(current) || current < 0) current = 0;
  if (!Number.isSafeInteger(next) || next < 0) return current;
  const sum = current + next;
  return sum > MAX_TELEMETRY_COUNT ? MAX_TELEMETRY_COUNT : sum;
}

function recordPipelineSpans(
  sender: SenderState,
  telemetry: NdiFrameTelemetry,
  nativeSentAtMs: number,
  acceptedCorrelation: AcceptedCorrelationAggregation | null,
): void {
  const {
    signatureChangedAtMs,
    captureStartedAtMs,
    rendererSendAtMs,
    mainReceivedAtMs,
    proxyForwardedAtMs,
    hostReceivedAtMs,
  } = telemetry;
  const samples = sender.pipelineSamples;
  const last = sender.pipelineLastSamples;

  if (typeof captureStartedAtMs === 'number') {
    const v = pushSpan(samples.frameAgeAtNativeSend, nativeSentAtMs - captureStartedAtMs);
    if (v !== null) last.frameAgeAtNativeSend = v;
    if (typeof rendererSendAtMs === 'number') {
      const c = pushSpan(samples.captureToRendererSend, rendererSendAtMs - captureStartedAtMs);
      if (c !== null) last.captureToRendererSend = c;
    }
  }
  if (typeof signatureChangedAtMs === 'number') {
    const v = pushSpan(samples.signatureToNativeSend, nativeSentAtMs - signatureChangedAtMs);
    if (v !== null) last.signatureToNativeSend = v;
  }
  if (acceptedCorrelation?.kind === 'activate') {
    const v = pushSpan(samples.activateToNativeSend, acceptedCorrelation.spanMs);
    if (v !== null) last.activateToNativeSend = v;
  }
  if (acceptedCorrelation?.kind === 'take') {
    const v = pushSpan(samples.takeToNativeSend, acceptedCorrelation.spanMs);
    if (v !== null) last.takeToNativeSend = v;
  }
  if (acceptedCorrelation) {
    const v = pushSpan(samples.takeReasonToNativeSend[acceptedCorrelation.reason], acceptedCorrelation.spanMs);
    if (v !== null) last.takeReasonToNativeSend[acceptedCorrelation.reason] = v;
  }
  if (typeof rendererSendAtMs === 'number' && typeof mainReceivedAtMs === 'number') {
    const v = pushSpan(samples.rendererToMainIpc, mainReceivedAtMs - rendererSendAtMs);
    if (v !== null) last.rendererToMainIpc = v;
  }
  if (typeof mainReceivedAtMs === 'number' && typeof proxyForwardedAtMs === 'number') {
    const v = pushSpan(samples.mainHandler, proxyForwardedAtMs - mainReceivedAtMs);
    if (v !== null) last.mainHandler = v;
  }
  if (typeof proxyForwardedAtMs === 'number' && typeof hostReceivedAtMs === 'number') {
    const v = pushSpan(samples.mainToHostIpc, hostReceivedAtMs - proxyForwardedAtMs);
    if (v !== null) last.mainToHostIpc = v;
  }
  if (
    typeof rendererSendAtMs === 'number'
    && typeof hostReceivedAtMs === 'number'
    && typeof mainReceivedAtMs !== 'number'
    && typeof proxyForwardedAtMs !== 'number'
  ) {
    const v = pushSpan(samples.directWorkerToHostIpc, hostReceivedAtMs - rendererSendAtMs);
    if (v !== null) last.directWorkerToHostIpc = v;
  }
  if (typeof hostReceivedAtMs === 'number') {
    const v = pushSpan(samples.hostToNative, nativeSentAtMs - hostReceivedAtMs);
    if (v !== null) last.hostToNative = v;
  }

  const pipeline = sender.diagnostics.performance.pipeline;
  pipeline.frameAgeAtNativeSend = computeStageStats(samples.frameAgeAtNativeSend, last.frameAgeAtNativeSend);
  pipeline.signatureToNativeSend = computeStageStats(samples.signatureToNativeSend, last.signatureToNativeSend);
  pipeline.activateToNativeSend = computeStageStats(samples.activateToNativeSend, last.activateToNativeSend);
  pipeline.takeToNativeSend = computeStageStats(samples.takeToNativeSend, last.takeToNativeSend);
  pipeline.takeReasonToNativeSend = {
    sequential: computeStageStats(samples.takeReasonToNativeSend.sequential, last.takeReasonToNativeSend.sequential),
    jump: computeStageStats(samples.takeReasonToNativeSend.jump, last.takeReasonToNativeSend.jump),
    crossItem: computeStageStats(samples.takeReasonToNativeSend.crossItem, last.takeReasonToNativeSend.crossItem),
    macro: computeStageStats(samples.takeReasonToNativeSend.macro, last.takeReasonToNativeSend.macro),
  };
  pipeline.captureToRendererSend = computeStageStats(samples.captureToRendererSend, last.captureToRendererSend);
  pipeline.rendererToMainIpc = computeStageStats(samples.rendererToMainIpc, last.rendererToMainIpc);
  pipeline.mainHandler = computeStageStats(samples.mainHandler, last.mainHandler);
  pipeline.mainToHostIpc = computeStageStats(samples.mainToHostIpc, last.mainToHostIpc);
  pipeline.directWorkerToHostIpc = computeStageStats(samples.directWorkerToHostIpc, last.directWorkerToHostIpc);
  pipeline.hostToNative = computeStageStats(samples.hostToNative, last.hostToNative);
}

const MAX_ACCEPTED_TAKE_KEYS = 128;

function isValidAcceptedCorrelationSpan(
  nativeSentAtMs: number,
  takeIssuedAtMs: number,
): number | null {
  if (!Number.isFinite(nativeSentAtMs) || !Number.isFinite(takeIssuedAtMs)) return null;
  const spanMs = nativeSentAtMs - takeIssuedAtMs;
  if (spanMs < 0 || spanMs > MAX_PIPELINE_SPAN_MS) return null;
  return spanMs;
}

function planAcceptedCorrelationAggregation(
  sender: SenderState,
  telemetry: NdiFrameTelemetry,
  nativeSentAtMs: number,
): AcceptedCorrelationAggregation | null {
  if (telemetry.takeKind !== 'take' && telemetry.takeKind !== 'activate') return null;
  if (telemetry.takeReason == null) return null;
  if (typeof telemetry.takeIssuedAtMs !== 'number') return null;
  const takeSessionId = telemetry.takeSessionId;
  const sequenceId = telemetry.takeSequenceId;
  if (typeof takeSessionId !== 'string' || takeSessionId.length === 0) return null;
  if (typeof sequenceId !== 'number' || !Number.isInteger(sequenceId)) return null;
  const spanMs = isValidAcceptedCorrelationSpan(nativeSentAtMs, telemetry.takeIssuedAtMs);
  if (spanMs === null) return null;
  const takeKey = `${takeSessionId}:${sequenceId}`;
  if (sender.acceptedTakeKeySet.has(takeKey)) return null;
  sender.acceptedTakeKeySet.add(takeKey);
  sender.acceptedTakeKeys.push(takeKey);
  if (sender.acceptedTakeKeys.length > MAX_ACCEPTED_TAKE_KEYS) {
    const evicted = sender.acceptedTakeKeys.shift();
    if (typeof evicted === 'string') sender.acceptedTakeKeySet.delete(evicted);
  }
  return {
    kind: telemetry.takeKind,
    reason: telemetry.takeReason,
    spanMs,
    takeKey,
  };
}

function computeStageStats(buffer: RollingSampleBuffer, lastMs: number): NdiPipelineStageStats {
  const sorted = buffer.snapshot().sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    lastMs,
    count: buffer.size,
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
    tally: diagnostics.tally ? { ...diagnostics.tally } : null,
    performance: cloneSenderPerformance(diagnostics.performance),
    audio: { ...diagnostics.audio },
  };
}

function cloneSenderPerformance(performance: NdiSenderPerformanceDiagnostics): NdiSenderPerformanceDiagnostics {
  return {
    ...performance,
    frameDrops: { ...performance.frameDrops },
    pipeline: clonePipelineLatency(performance.pipeline),
  };
}

function clonePipelineLatency(pipeline: NdiPipelineLatencyDiagnostics): NdiPipelineLatencyDiagnostics {
  return {
    frameAgeAtNativeSend: { ...pipeline.frameAgeAtNativeSend },
    signatureToNativeSend: { ...pipeline.signatureToNativeSend },
    activateToNativeSend: { ...pipeline.activateToNativeSend },
    takeToNativeSend: { ...pipeline.takeToNativeSend },
    takeReasonToNativeSend: {
      sequential: { ...pipeline.takeReasonToNativeSend.sequential },
      jump: { ...pipeline.takeReasonToNativeSend.jump },
      crossItem: { ...pipeline.takeReasonToNativeSend.crossItem },
      macro: { ...pipeline.takeReasonToNativeSend.macro },
    },
    captureToRendererSend: { ...pipeline.captureToRendererSend },
    rendererToMainIpc: { ...pipeline.rendererToMainIpc },
    mainHandler: { ...pipeline.mainHandler },
    mainToHostIpc: { ...pipeline.mainToHostIpc },
    directWorkerToHostIpc: { ...pipeline.directWorkerToHostIpc },
    hostToNative: { ...pipeline.hostToNative },
  };
}
