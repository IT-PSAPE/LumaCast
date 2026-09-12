import { useImageCacheStats } from '@lumacast/canvas';
import { SectionShell } from './section-shell';
import { Stat } from './stat';
import { formatNumber, formatBytes } from './observability-format';

export function ImageCacheSection() {
  const stats = useImageCacheStats();
  return (
    <SectionShell title="Image cache" subtitle="In-memory image entries kept hot for the canvas.">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
        <Stat label="Entries" value={formatNumber(stats.entryCount)} />
        <Stat label="Estimated memory" value={formatBytes(stats.totalEstimatedBytes)} />
        <Stat label="Loaded" value={formatNumber(stats.loadedCount)} />
        <Stat label="Loading" value={formatNumber(stats.loadingCount)} />
        <Stat label="Errors" value={formatNumber(stats.errorCount)} highlight={stats.errorCount > 0} />
        <Stat label="Retained" value={formatNumber(stats.retainedCount)} />
        <Stat label="Warm T1" value={formatNumber(stats.warmTier1Count)} />
        <Stat label="Warm T2" value={formatNumber(stats.warmTier2Count)} />
        <Stat label="Warm inflight" value={formatNumber(stats.warmInFlightCount)} />
        <Stat label="Warm hits" value={formatNumber(stats.warmRetainHitCount)} />
        <Stat label="Warm wasted" value={formatNumber(stats.warmWastedCount)} />
        <Stat label="Warm cancelled" value={formatNumber(stats.warmCancelledCount)} />
        <Stat label="Evictable" value={formatNumber(stats.evictableCount)} />
        <Stat label="Evictable bytes" value={formatBytes(stats.evictableEstimatedBytes)} />
      </div>
    </SectionShell>
  );
}
