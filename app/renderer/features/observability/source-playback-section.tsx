import { useMemo } from 'react';
import { useMetricsStore } from './metrics-store';
import { SectionShell } from './section-shell';
import { Stat } from './stat';
import { formatNumber } from './observability-format';

export function SourcePlaybackSection() {
  const samples = useMetricsStore((s) => s.videoQualities);
  const list = useMemo(() => Object.values(samples), [samples]);
  return (
    <SectionShell title="Source playback" subtitle="Per-video drop counts and decoded fps from HTMLVideoElement.getVideoPlaybackQuality().">
      {list.length === 0 ? (
        <p className="text-sm text-tertiary">No video elements in the DOM.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((video) => {
            const dropRate = video.totalVideoFrames > 0
              ? (video.droppedVideoFrames / video.totalVideoFrames) * 100
              : 0;
            return (
              <div key={video.src} className="rounded border border-secondary px-3 py-2">
                <div className="flex items-center justify-between gap-3 pb-1">
                  <span className="truncate text-sm font-medium text-primary">{video.label}</span>
                  <span className="text-xs text-tertiary">{video.isPlaying ? 'playing' : 'paused'}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-4">
                  <Stat label="Decoded fps" value={video.decodedFps.toFixed(1)} highlight={video.isPlaying && video.decodedFps < 24} />
                  <Stat label="Total frames" value={formatNumber(video.totalVideoFrames)} />
                  <Stat label="Dropped" value={`${formatNumber(video.droppedVideoFrames)} (${dropRate.toFixed(2)}%)`} highlight={dropRate > 1} />
                  <Stat label="Position" value={`${video.currentTimeSeconds.toFixed(1)} / ${video.durationSeconds.toFixed(1)} s`} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}
