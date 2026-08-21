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
      </div>
    </SectionShell>
  );
}
