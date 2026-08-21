import type { ReactNode } from 'react';

export function Stat({ label, value, highlight }: { label: string; value: ReactNode; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-tertiary">{label}</span>
      <span className={`font-mono text-xs ${highlight ? 'text-amber-300' : 'text-secondary'}`}>{value}</span>
    </div>
  );
}
