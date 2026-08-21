import { useMetricsStore } from './metrics-store';
import { SectionShell } from './section-shell';
import { Stat } from './stat';
import { formatBytes, formatDuration } from './observability-format';

export function MemorySection() {
  const renderer = useMetricsStore((s) => s.rendererMemory);
  const system = useMetricsStore((s) => s.systemMetrics);
  return (
    <SectionShell title="Memory & CPU" subtitle="Renderer JS heap and main-process metrics, sampled while this page is open.">
      <div className="flex flex-col gap-3">
        <div>
          <div className="pb-1 text-xs font-semibold uppercase tracking-wide text-tertiary">Renderer</div>
          {!renderer ? (
            <p className="text-sm text-tertiary">performance.memory unavailable in this context.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
              <Stat label="JS heap used" value={formatBytes(renderer.jsHeapSizeBytes)} />
              <Stat label="JS heap total" value={formatBytes(renderer.totalJSHeapSizeBytes)} />
              <Stat label="JS heap limit" value={formatBytes(renderer.jsHeapLimitBytes)} />
            </div>
          )}
        </div>
        <div>
          <div className="pb-1 text-xs font-semibold uppercase tracking-wide text-tertiary">Main process</div>
          {!system ? (
            <p className="text-sm text-tertiary">Sampling…</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-3">
              <Stat label="RSS" value={formatBytes(system.main.rssBytes)} />
              <Stat label="Heap used" value={formatBytes(system.main.heapUsedBytes)} />
              <Stat label="Heap total" value={formatBytes(system.main.heapTotalBytes)} />
              <Stat label="External" value={formatBytes(system.main.externalBytes)} />
              <Stat label="CPU" value={`${system.main.cpuPercent.toFixed(1)}%`} highlight={system.main.cpuPercent > 60} />
              <Stat label="Uptime" value={formatDuration(system.uptimeSeconds * 1000)} />
            </div>
          )}
        </div>
      </div>
    </SectionShell>
  );
}
