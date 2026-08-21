import type { ObsEventLevel } from './metrics-store';

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const minutes = Math.floor(sec / 60);
  const remainingSec = sec % 60;
  if (minutes < 60) return `${minutes}m ${remainingSec.toString().padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin.toString().padStart(2, '0')}m`;
}

export function colorForLevel(level: ObsEventLevel): string {
  switch (level) {
    case 'error': return 'text-red-400';
    case 'warn': return 'text-amber-400';
    default: return 'text-secondary';
  }
}

export function lineColor(line: string): string {
  if (line.includes(' ERROR ')) return 'text-red-400';
  if (line.includes(' WARN ')) return 'text-amber-400';
  return '';
}
