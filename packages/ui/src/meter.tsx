import { memo } from 'react';
import { cn } from './cn';

// Meter vs Progress: Meter measures a live level that fluctuates (role="meter",
// audio VU, CPU load); Progress measures completion of a task that ends
// (role="progressbar"). They are deliberately separate components; do not merge them.
//
// Domain mapping stays at the call site: the meter takes generic numeric zones.
// Stream's dB semantics (floor, -18/-9 thresholds, dbToFraction) must be mapped
// to min/max/zones by the caller, not added here.

type Tone = 'success' | 'warning' | 'error' | 'brand';

export interface MeterZone {
  /** Inclusive lower bound of the zone, in the same units as `value`. */
  from: number;
  tone: Tone;
}

export interface MeterProps {
  value: number;
  min?: number;
  max?: number;
  /** Coloured bands, ascending by `from`. Callers should hoist this array so memoisation holds. */
  zones?: MeterZone[];
  orientation?: 'horizontal' | 'vertical';
  /** Render N discrete blocks (LED look) instead of a continuous bar. */
  segments?: number;
  /** Peak-hold marker position, same units as `value`. */
  peak?: number;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}

// Hoisted lookups: no per-render object/class-string allocation.
const TONE_BG: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  brand: 'bg-brand',
};
const THICKNESS = {
  horizontal: { sm: 'h-1.5 w-full', md: 'h-2.5 w-full' },
  vertical: { sm: 'w-1.5 h-full', md: 'w-2.5 h-full' },
} as const;
const DEFAULT_ZONES: MeterZone[] = [{ from: -Infinity, tone: 'brand' }];

function toneAt(zones: MeterZone[], at: number): Tone {
  let tone = zones[0]?.tone ?? 'brand';
  for (let i = 0; i < zones.length; i++) {
    const zone = zones[i];
    if (zone && at >= zone.from) tone = zone.tone;
  }
  return tone;
}

function fractionOf(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const f = (value - min) / (max - min);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

// memo: audio meters re-render at frame rate; props are primitives (plus a hoisted `zones`).
// The fill is a single element driven by transform, with no React state or CSS transition.
export const Meter = memo(function Meter({
  value,
  min = 0,
  max = 100,
  zones = DEFAULT_ZONES,
  orientation = 'horizontal',
  segments,
  peak,
  size = 'md',
  label,
  className,
}: MeterProps) {
  const vertical = orientation === 'vertical';
  const fraction = fractionOf(value, min, max);
  const clamped = Math.min(max, Math.max(min, value));

  let body;
  if (segments && segments > 0) {
    const lit = Math.round(fraction * segments);
    const blocks = [];
    for (let i = 0; i < segments; i++) {
      const at = min + ((i + 0.5) / segments) * (max - min);
      blocks.push(
        <div
          key={i}
          className={cn('min-h-0 min-w-0 flex-1 rounded-[1px]', i < lit ? TONE_BG[toneAt(zones, at)] : 'bg-tertiary')}
        />,
      );
    }
    body = <div className={cn('flex gap-px', vertical ? 'h-full flex-col-reverse' : 'w-full')}>{blocks}</div>;
  } else {
    body = (
      <div
        className={cn('h-full w-full', TONE_BG[toneAt(zones, clamped)], vertical ? 'origin-bottom' : 'origin-left')}
        style={{ transform: vertical ? `scaleY(${fraction})` : `scaleX(${fraction})` }}
      />
    );
  }

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clamped}
      className={cn(
        'relative overflow-hidden rounded-[2px]',
        segments ? null : 'bg-tertiary',
        THICKNESS[orientation][size],
        className,
      )}
    >
      {body}
      {peak !== undefined ? (
        <div
          className={cn('absolute bg-[var(--text-color-primary)]', vertical ? 'inset-x-0 h-px' : 'inset-y-0 w-px')}
          style={vertical ? { bottom: `${fractionOf(peak, min, max) * 100}%` } : { left: `${fractionOf(peak, min, max) * 100}%` }}
        />
      ) : null}
    </div>
  );
});
