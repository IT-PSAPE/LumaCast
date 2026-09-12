import { useMemo, useSyncExternalStore } from 'react';
import { getVideoPoolStats, subscribeToVideoPool } from '@lumacast/canvas';
import { useMetricsStore } from './metrics-store';
import { SectionShell } from './section-shell';
import { Stat } from './stat';
import { formatNumber } from './observability-format';

export function SourcePlaybackSection() {
  const samples = useMetricsStore((s) => s.videoQualities);
  const list = useMemo(() => Object.values(samples), [samples]);
  const videoPool = useSyncExternalStore(subscribeToVideoPool, getVideoPoolStats, getVideoPoolStats);
  const mountedCount = list.length;
  const playingCount = list.filter((video) => video.isPlaying).length;
  const residentCount = list.filter((video) => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA).length;
  const readyCount = list.filter((video) => video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA).length;
  return (
    <SectionShell title="Source playback" subtitle="DOM video quality samples plus canvas video-pool counts from current APIs.">
      {list.length === 0 ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded border border-secondary px-3 py-2 text-sm text-secondary md:grid-cols-4">
            <Stat label="DOM videos mounted" value="0" />
            <Stat label="Canvas layer videos" value={formatNumber(videoPool.layerVideoCount)} />
            <Stat label="Canvas detached videos" value={formatNumber(videoPool.detachedVideoCount)} />
            <Stat label="Canvas loaded" value={formatNumber(videoPool.layerLoadedCount + videoPool.detachedLoadedCount)} />
            <Stat label="Canvas playing" value={formatNumber(videoPool.layerPlayingCount + videoPool.detachedPlayingCount)} />
            <Stat label="Canvas warm resident" value={formatNumber(videoPool.warmResidentCount)} />
            <Stat label="Canvas warm inflight" value={formatNumber(videoPool.warmInflightCount)} />
            <Stat label="Canvas warm hits" value={formatNumber(videoPool.warmHitCount)} />
            <Stat label="Canvas warm misses" value={formatNumber(videoPool.warmMissCount)} />
            <Stat label="Canvas warm wasted" value={formatNumber(videoPool.warmWastedCount)} />
          </div>
          <p className="text-sm text-tertiary">No video elements in the DOM.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded border border-secondary px-3 py-2 text-sm text-secondary md:grid-cols-5">
            <Stat label="DOM videos mounted" value={formatNumber(mountedCount)} />
            <Stat label="DOM playing" value={formatNumber(playingCount)} />
            <Stat label="DOM resident" value={formatNumber(residentCount)} />
            <Stat label="DOM ready" value={formatNumber(readyCount)} />
            <Stat label="Canvas layer videos" value={formatNumber(videoPool.layerVideoCount)} />
            <Stat label="Canvas detached videos" value={formatNumber(videoPool.detachedVideoCount)} />
            <Stat label="Canvas loaded" value={formatNumber(videoPool.layerLoadedCount + videoPool.detachedLoadedCount)} />
            <Stat label="Canvas playing" value={formatNumber(videoPool.layerPlayingCount + videoPool.detachedPlayingCount)} />
            <Stat label="Canvas warm resident" value={formatNumber(videoPool.warmResidentCount)} />
            <Stat label="Canvas warm inflight" value={formatNumber(videoPool.warmInflightCount)} />
            <Stat label="Canvas warm hits" value={formatNumber(videoPool.warmHitCount)} />
            <Stat label="Canvas warm misses" value={formatNumber(videoPool.warmMissCount)} />
            <Stat label="Canvas warm wasted" value={formatNumber(videoPool.warmWastedCount)} />
          </div>
          {list.map((video) => {
            const dropRate = video.totalVideoFrames > 0
              ? (video.droppedVideoFrames / video.totalVideoFrames) * 100
              : 0;
            return (
              <div key={video.elementKey} className="rounded border border-secondary px-3 py-2">
                <div className="flex items-center justify-between gap-3 pb-1">
                  <span className="truncate text-sm font-medium text-primary">{video.label}</span>
                  <span className="text-xs text-tertiary">{video.isPlaying ? 'playing' : 'paused'}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-4">
                  <Stat label="Decoded fps" value={video.decodedFps.toFixed(1)} highlight={video.isPlaying && video.decodedFps < 24} />
                  <Stat label="Total frames" value={formatNumber(video.totalVideoFrames)} />
                  <Stat label="Dropped" value={`${formatNumber(video.droppedVideoFrames)} (${dropRate.toFixed(2)}%)`} highlight={dropRate > 1} />
                  <Stat label="Position" value={`${video.currentTimeSeconds.toFixed(1)} / ${video.durationSeconds.toFixed(1)} s`} />
                  <Stat label="Ready state" value={String(video.readyState)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionShell>
  );
}
