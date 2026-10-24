import { cn } from './cn';
import { cv } from './cv';

// Progress vs Meter: Progress measures completion of a task that ends
// (role="progressbar"); Meter measures a live level that fluctuates
// (role="meter"). They are deliberately separate components; do not merge them.

export interface ProgressProps {
  /** 0..max. `null` or `undefined` renders the indeterminate state. */
  value?: number | null;
  max?: number;
  tone?: 'brand' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md';
  /** Render a percentage readout beside the bar. */
  showValue?: boolean;
  formatValue?: (value: number, max: number) => string;
  /** Accessible name. */
  label?: string;
  className?: string;
}

const track = cv({
  base: 'w-full overflow-hidden rounded-full bg-tertiary',
  variants: { size: { sm: 'h-1', md: 'h-1.5' } },
  defaultVariants: { size: 'md' },
});

const fill = cv({
  base: 'h-full rounded-full',
  variants: {
    tone: { brand: 'bg-brand', success: 'bg-success', warning: 'bg-warning', error: 'bg-error' },
  },
  defaultVariants: { tone: 'brand' },
});

function defaultFormat(value: number, max: number): string {
  return `${Math.round((value / max) * 100)}%`;
}

export function Progress({
  value,
  max = 100,
  tone = 'brand',
  size = 'md',
  showValue = false,
  formatValue = defaultFormat,
  label,
  className,
}: ProgressProps) {
  const determinate = value != null;
  const clamped = determinate ? Math.min(max, Math.max(0, value)) : 0;
  const fraction = max > 0 ? clamped / max : 0;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={determinate ? clamped : undefined}
        className={track({ size })}
      >
        {determinate ? (
          <div
            className={cn(fill({ tone }), 'origin-left transition-transform duration-200 motion-reduce:transition-none')}
            style={{ width: '100%', transform: `scaleX(${fraction})` }}
          />
        ) : (
          // Indeterminate: a pulsing partial bar. `motion-safe:` means reduced motion gets a static bar.
          <div className={cn(fill({ tone }), 'w-1/3 motion-safe:animate-pulse')} />
        )}
      </div>
      {showValue && determinate ? (
        <span className="label-xs shrink-0 tabular-nums text-tertiary">{formatValue(clamped, max)}</span>
      ) : null}
    </div>
  );
}
