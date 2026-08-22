import type { NdiOutputName, NdiActiveSenderDiagnostics, NdiOutputAvailabilityDropCounts } from '@lumacast/protocol';
import { Stat } from './stat';
import { PipelineLatencyGroup } from './pipeline-latency-group';
import { ReceiverHealthGroup } from './receiver-health-group';
import { OUTPUT_TITLES } from './observability-constants';
import { formatDuration, formatNumber, formatBytes } from './observability-format';

function formatDropReasons(frameDrops: NdiActiveSenderDiagnostics['performance']['frameDrops']): string {
  const visible = Object.entries(frameDrops).filter(([, count]) => count > 0);
  if (visible.length === 0) return '—';
  return visible.map(([reason, count]) => `${reason}:${formatNumber(count)}`).join(' · ');
}

function formatAvailabilityDrops(frameDrops: NdiOutputAvailabilityDropCounts): string {
  const visible = Object.entries(frameDrops).filter(([, count]) => count > 0);
  if (visible.length === 0) return '—';
  return visible.map(([reason, count]) => `${reason}:${formatNumber(count)}`).join(' · ');
}

export function SenderCard({
  name,
  sender,
  availabilityDrops,
}: {
  name: NdiOutputName;
  sender: NdiActiveSenderDiagnostics | null;
  availabilityDrops: NdiOutputAvailabilityDropCounts;
}) {
  if (!sender) {
    return (
      <div className="rounded border border-secondary px-3 py-2 text-sm text-tertiary">
        {OUTPUT_TITLES[name]} sender: inactive
        <div className="pt-1">
          <span className="font-medium text-primary">Unavailable/disabled drops:</span> {formatAvailabilityDrops(availabilityDrops)}
        </div>
      </div>
    );
  }
  const performance = sender.performance;
  const audio = sender.audio;
  const uptimeMs = Date.now() - sender.startedAtMs;
  const dropRate = performance.framesCaptured > 0
    ? ((performance.framesDroppedBackpressure / performance.framesCaptured) * 100)
    : 0;
  return (
    <div className="rounded border border-secondary px-3 py-3">
      <div className="flex items-center justify-between gap-3 pb-2">
        <h3 className="text-sm font-semibold text-primary">{OUTPUT_TITLES[name]} · {sender.senderName}</h3>
        <span className="text-xs text-tertiary">
          {sender.width}×{sender.height} · {sender.withAlpha ? 'BGRA' : 'BGRX'} · {sender.asyncVideoSend ? 'async' : 'sync'} · up {formatDuration(uptimeMs)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <Stat label="Connections" value={sender.connectionCount ?? 'unknown'} />
        <Stat label="Frames sent" value={formatNumber(performance.framesSent)} />
        <Stat label="Captured" value={formatNumber(performance.framesCaptured)} />
        <Stat label="Replayed" value={formatNumber(performance.framesReplayed)} />
        <Stat label="Corrective retries" value={formatNumber(performance.correctiveFrameRetries)} highlight={performance.correctiveFrameRetries > 0} />
        <Stat label="Backpressure drops" value={`${formatNumber(performance.framesDroppedBackpressure)} (${dropRate.toFixed(1)}%)`} highlight={dropRate > 1} />
        <Stat label="Skipped captures" value={formatNumber(performance.skippedCaptures)} />
        <Stat label="Rejected" value={formatNumber(performance.framesRejected)} highlight={performance.framesRejected > 0} />
        <Stat label="Blackout sent" value={formatNumber(performance.blackoutFramesSent)} />
        <Stat label="Bytes received" value={formatBytes(performance.bytesReceived)} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <Stat label="Capture avg" value={`${performance.avgCaptureDurationMs.toFixed(2)} ms`} />
        <Stat label="Readback avg" value={`${performance.avgReadbackDurationMs.toFixed(2)} ms`} />
        <Stat label="Send avg" value={`${performance.avgSendDurationMs.toFixed(2)} ms`} />
        <Stat label="Send p50" value={`${performance.p50SendDurationMs.toFixed(2)} ms`} />
        <Stat label="Send p95" value={`${performance.p95SendDurationMs.toFixed(2)} ms`} highlight={performance.p95SendDurationMs > 16} />
        <Stat label="Send p99" value={`${performance.p99SendDurationMs.toFixed(2)} ms`} highlight={performance.p99SendDurationMs > 33} />
        <Stat label="Send jitter (σ)" value={`${performance.sendIntervalJitterMs.toFixed(2)} ms`} highlight={performance.sendIntervalJitterMs > 5} />
        <Stat label="Frame size last" value={formatBytes(performance.lastFrameBytes)} />
        <Stat
          label="Frame size range"
          value={performance.minFrameBytes > 0
            ? `${formatBytes(performance.minFrameBytes)} – ${formatBytes(performance.maxFrameBytes)}`
            : '—'}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <Stat label="Audio frames in" value={formatNumber(audio.audioFramesReceived)} />
        <Stat label="Audio frames sent" value={formatNumber(audio.audioFramesSent)} />
        <Stat label="Audio samples sent" value={formatNumber(audio.audioSamplesSent)} />
        <Stat label="Silence frames" value={formatNumber(audio.audioSilenceFramesSent)} />
        <Stat label="Audio rejected" value={formatNumber(audio.audioFramesRejected)} highlight={audio.audioFramesRejected > 0} />
        <Stat label="Audio format" value={audio.lastSampleRate > 0 ? `${audio.lastSampleRate} Hz × ${audio.lastChannels}ch` : 'inactive'} />
      </div>
      <div className="mt-2 text-sm text-secondary">
        <span className="font-medium text-primary">Drop reasons:</span> {formatDropReasons(performance.frameDrops)}
      </div>
      <div className="mt-1 text-sm text-secondary">
        <span className="font-medium text-primary">Unavailable/disabled drops:</span> {formatAvailabilityDrops(availabilityDrops)}
      </div>
      <PipelineLatencyGroup pipeline={performance.pipeline} />
      <ReceiverHealthGroup connectionCount={sender.connectionCount} tally={sender.tally} />
    </div>
  );
}
