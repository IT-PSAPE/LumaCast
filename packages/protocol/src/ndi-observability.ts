// ---------------------------------------------------------------------------
// NDI output/diagnostics and observability surface (issue #154, parent
// #116): the IPC event/result shapes for NDI output control
// (app/main/ndi/*, app/core/ipc.ts's `NdiEventPayloads`) and the log/metrics
// surface exposed to the renderer (app/main/logger.ts,
// app/main/system-metrics.ts). Grouped as one module because both are
// process-neutral, self-contained observability wire shapes with no domain
// dependency — neither family needs anything from `@core/domain`.
// ---------------------------------------------------------------------------

export type NdiOutputName = 'audience' | 'stage';

export interface NdiOutputState {
  audience: boolean;
  stage: boolean;
}

export type NdiSourceStatus = 'idle' | 'live';

export interface NdiOutputConfig {
  senderName: string;
  withAlpha: boolean;
}

export type NdiOutputConfigMap = Record<NdiOutputName, NdiOutputConfig>;

export interface NdiTallyState {
  onProgram: boolean;
  onPreview: boolean;
}

export interface NdiActiveSenderDiagnostics {
  senderName: string;
  width: number;
  height: number;
  withAlpha: boolean;
  asyncVideoSend: boolean;
  connectionCount: number | null;
  // Bidirectional NDI tally signal (receiver tells sender "I'm on program /
  // preview"). Null if the loaded runtime doesn't expose tally polling.
  tally: NdiTallyState | null;
  startedAtMs: number;
  performance: NdiSenderPerformanceDiagnostics;
  audio: NdiSenderAudioDiagnostics;
}

export type NdiTakeKind = 'activate' | 'take';
export const NDI_TAKE_KINDS = ['activate', 'take'] as const satisfies readonly NdiTakeKind[];

export type NdiTakeReason =
  | 'sequential'
  | 'jump'
  | 'crossItem'
  | 'macro';
export const NDI_TAKE_REASONS = ['sequential', 'jump', 'crossItem', 'macro'] as const satisfies readonly NdiTakeReason[];

export type NdiFrameDropReason =
  | 'backpressure'
  | 'ackTimeout'
  | 'captureFailed'
  | 'bitmapFailed'
  | 'invalidPayload'
  | 'outputDisabled'
  | 'senderUnavailable'
  | 'nativeSendFailed';
export const NDI_FRAME_DROP_REASONS = [
  'backpressure',
  'ackTimeout',
  'captureFailed',
  'bitmapFailed',
  'invalidPayload',
  'outputDisabled',
  'senderUnavailable',
  'nativeSendFailed',
] as const satisfies readonly NdiFrameDropReason[];
export const NDI_RENDERER_FRAME_DROP_REASONS = [
  'backpressure',
  'ackTimeout',
  'captureFailed',
  'bitmapFailed',
] as const satisfies readonly NdiFrameDropReason[];

export type NdiFrameDropReasonCounts = Record<NdiFrameDropReason, number>;

export type NdiFrameReleaseReason =
  | 'sent'
  | 'invalidPayload'
  | 'outputDisabled'
  | 'senderUnavailable'
  | 'nativeSendFailed';

export interface NdiFrameRelease {
  name: NdiOutputName;
  attemptId?: string;
  accepted: boolean;
  reason: NdiFrameReleaseReason;
  releasedAtMs: number;
}

export interface NdiFrameTelemetry {
  attemptId?: string;
  captureDurationMs: number;
  readbackDurationMs: number;
  skippedCaptures: number;
  framesDroppedBackpressure: number;
  correctiveFrameRetries: number;
  dropReasons?: Partial<NdiFrameDropReasonCounts>;
  // Cross-process Date.now() timestamps. Each stage stamps as the frame
  // travels: the renderer side sets signature/capture/rendererSend; the
  // copy path's main process sets mainReceived and proxyForwarded; utility
  // sets hostReceived. Direct worker transport intentionally omits both main
  // timestamps. The native send timestamp is computed inside the service and
  // not echoed back.
  // Optional — older telemetry shapes still validate.
  signatureChangedAtMs?: number | null;
  takeKind?: NdiTakeKind;
  takeReason?: NdiTakeReason;
  takeSessionId?: string;
  takeSequenceId?: number;
  takeIssuedAtMs?: number;
  captureStartedAtMs?: number;
  rendererSendAtMs?: number;
  mainReceivedAtMs?: number;
  proxyForwardedAtMs?: number;
  hostReceivedAtMs?: number;
}

export interface NdiPipelineStageStats {
  p50: number;
  p95: number;
  lastMs: number;
  count: number;
}

export interface NdiPipelineLatencyDiagnostics {
  // Headline numbers — the user's symptom is sender-side latency, and
  // signatureToNativeSend is how long between a state change and the native
  // send call returning for that accepted attempt.
  frameAgeAtNativeSend: NdiPipelineStageStats;
  signatureToNativeSend: NdiPipelineStageStats;
  activateToNativeSend: NdiPipelineStageStats;
  takeToNativeSend: NdiPipelineStageStats;
  takeReasonToNativeSend: Record<NdiTakeReason, NdiPipelineStageStats>;
  // Per-stage spans — for attributing where time goes when the headline
  // numbers are too high.
  captureToRendererSend: NdiPipelineStageStats;
  rendererToMainIpc: NdiPipelineStageStats;
  mainHandler: NdiPipelineStageStats;
  mainToHostIpc: NdiPipelineStageStats;
  // Populated only by the direct renderer-worker → utility-process path.
  directWorkerToHostIpc: NdiPipelineStageStats;
  hostToNative: NdiPipelineStageStats;
}

export interface NdiSenderPerformanceDiagnostics {
  framesCaptured: number;
  framesSent: number;
  framesReplayed: number;
  framesRejected: number;
  skippedCaptures: number;
  framesDroppedBackpressure: number;
  correctiveFrameRetries: number;
  frameDrops: NdiFrameDropReasonCounts;
  bytesReceived: number;
  cacheCopyBytes: number;
  avgCaptureDurationMs: number;
  avgReadbackDurationMs: number;
  avgSendDurationMs: number;
  // p50/p95/p99 of send durations over the rolling window — captures
  // latency tail not visible from the average.
  p50SendDurationMs: number;
  p95SendDurationMs: number;
  p99SendDurationMs: number;
  // Standard deviation of the inter-send interval. High jitter is a
  // strong signal that something upstream (capture, IPC, GC) is stalling.
  sendIntervalJitterMs: number;
  lastFrameBytes: number;
  minFrameBytes: number;
  maxFrameBytes: number;
  blackoutFramesSent: number;
  // Stage-by-stage pipeline latency for diagnosing where sender-side time
  // is going (renderer capture → IPC → utility process → native send).
  pipeline: NdiPipelineLatencyDiagnostics;
}

export interface NdiSenderAudioDiagnostics {
  audioFramesReceived: number;
  audioFramesSent: number;
  audioFramesRejected: number;
  audioSamplesSent: number;
  audioSilenceFramesSent: number;
  lastSampleRate: number;
  lastChannels: number;
}

export type NdiOutputAvailabilityDropCounts = Pick<
  NdiFrameDropReasonCounts,
  'outputDisabled' | 'senderUnavailable'
>;

export interface NdiDiagnostics {
  outputState: NdiOutputState;
  outputConfig: NdiOutputConfig;
  outputConfigs: NdiOutputConfigMap;
  runtimeLoaded: boolean;
  runtimePath: string | null;
  activeSender: NdiActiveSenderDiagnostics | null;
  senders: Record<NdiOutputName, NdiActiveSenderDiagnostics | null>;
  availabilityDrops: Record<NdiOutputName, NdiOutputAvailabilityDropCounts>;
  sourceStatus: NdiSourceStatus;
  lastError: string | null;
}

export interface SystemProcessMetrics {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  cpuPercent: number;
  eventLoopLag: SystemEventLoopLagStats;
}

export interface SystemEventLoopLagStats {
  lastMs: number;
  p95Ms: number;
  maxMs: number;
  count: number;
}

export interface SystemMetricsSnapshot {
  capturedAtMs: number;
  uptimeSeconds: number;
  main: SystemProcessMetrics;
}

export interface LogSessionSummary {
  path: string;
  fileName: string;
  sizeBytes: number;
  modifiedAtMs: number;
  isCurrent: boolean;
}

export interface LogReadResult {
  totalBytes: number;
  // Byte offset returned to the caller for incremental reads. Pass back as
  // `offset` to fetch the next chunk after `lines`.
  nextOffset: number;
  lines: string[];
}
