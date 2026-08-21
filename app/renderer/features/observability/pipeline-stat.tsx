import type { NdiPipelineStageStats } from '@lumacast/protocol';
import { Stat } from './stat';

export function PipelineStat({
  label,
  stats,
  warnP95,
}: {
  label: string;
  stats: NdiPipelineStageStats;
  warnP95: number;
}) {
  const text = stats.count === 0
    ? '—'
    : `${stats.p50.toFixed(1)} / ${stats.p95.toFixed(1)} · ${stats.lastMs.toFixed(1)}`;
  return <Stat label={label} value={text} highlight={stats.p95 > warnP95} />;
}
