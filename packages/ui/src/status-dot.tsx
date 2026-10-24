import { cn } from './cn';
import { cv } from './cv';

export type StatusTone = 'neutral' | 'brand' | 'success' | 'warning' | 'error';

// Tones are colour only. They carry no live/recording/idle meaning; call sites
// choose the tone (see the note in badge.tsx about conflicting usages).
const dotStyles = cv({
  base: 'relative inline-flex shrink-0 rounded-full',
  variants: {
    tone: {
      neutral: 'bg-tertiary',
      brand: 'bg-brand',
      success: 'bg-success',
      warning: 'bg-warning',
      error: 'bg-error',
    },
    size: {
      sm: 'size-1.5',
      md: 'size-2',
    },
  },
  defaultVariants: { tone: 'neutral', size: 'sm' },
});

// The pulse ring inherits the dot's colour via currentColor-free tone classes.
const ringStyles = cv({
  base: 'absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping',
  variants: {
    tone: {
      neutral: 'bg-tertiary',
      brand: 'bg-brand',
      success: 'bg-success',
      warning: 'bg-warning',
      error: 'bg-error',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface StatusDotProps {
  tone?: StatusTone;
  size?: 'sm' | 'md';
  /** Attention pulse. Uses `motion-safe:`, so it never animates under prefers-reduced-motion. */
  pulse?: boolean;
  /** Accessible name. When absent the dot is aria-hidden. */
  label?: string;
  className?: string;
}

export function StatusDot({ tone, size, pulse = false, label, className }: StatusDotProps) {
  return (
    <span
      className={cn(dotStyles({ tone, size }), className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {pulse ? <span aria-hidden="true" className={ringStyles({ tone })} /> : null}
    </span>
  );
}
