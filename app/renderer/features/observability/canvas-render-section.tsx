import { useMetricsStore } from './metrics-store';
import { SectionShell } from './section-shell';
import { Stat } from './stat';
import { formatNumber } from './observability-format';

export function CanvasRenderSection() {
  const render = useMetricsStore((s) => s.canvasRender);
  return (
    <SectionShell title="Canvas / render" subtitle="Renderer rAF cadence plus long-task pressure and scene context.">
      {!render ? (
        <p className="text-sm text-tertiary">Sampling…</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-secondary md:grid-cols-4">
          <Stat label="Frame interval p50" value={`${render.p50FrameIntervalMs.toFixed(2)} ms`} />
          <Stat label="Frame interval p95" value={`${render.p95FrameIntervalMs.toFixed(2)} ms`} highlight={render.p95FrameIntervalMs > 25} />
          <Stat label="Last interval" value={`${render.lastFrameIntervalMs.toFixed(2)} ms`} />
          <Stat label="Over-budget frames" value={formatNumber(render.overBudgetFrameCount)} highlight={render.overBudgetFrameCount > 0} />
          <Stat label="Long tasks" value={formatNumber(render.longTaskCount)} highlight={render.longTaskCount > 0} />
          <Stat label="Worst long task" value={`${render.worstLongTaskMs.toFixed(2)} ms`} highlight={render.worstLongTaskMs > 50} />
          <Stat label="Canvases mounted" value={formatNumber(render.mountedCanvasCount)} />
          <Stat label="Videos mounted" value={formatNumber(render.mountedVideoCount)} />
          <Stat label="Videos playing" value={formatNumber(render.playingVideoCount)} />
          <Stat label="Workbench" value={render.workbenchMode} />
          <Stat label="Drawer" value={render.drawerTab} />
          <Stat label="Visibility" value={render.visibilityState} />
        </div>
      )}
    </SectionShell>
  );
}
