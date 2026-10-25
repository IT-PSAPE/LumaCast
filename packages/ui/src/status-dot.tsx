import { cn } from './cn';
import { cv } from './cv';

export type StatusTone = 'neutral' | 'brand' | 'success' | 'warning' | 'error';

// Tones are colour only. They carry no live/recording/idle meaning; call sites
// choose the tone (see the note in badge.tsx about conflicting usages).
const dotStyles = cv({
  base: 'relative inline-flex shrink-0 rounded-full',
  variants: {
    tone: {
      // `bg-current` + `text-tertiary`, not `bg-tertiary`: the tertiary SURFACE
      // token is one step from bg-secondary and identical to bg-tertiary, so a
      // neutral dot was invisible on both (found in cast's status bar, which is
      // bg-secondary). The tertiary TEXT token is the quiet-but-readable one in
      // either theme, which is what an indicator needs.
      neutral: 'bg-current text-tertiary',
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

// The ring inherits the dot's own background (tone class, or bg-current on a
// solid Badge), so it is never the same colour as the surface behind it.
const ringClass = 'absolute inset-0 rounded-full bg-inherit opacity-60 motion-safe:animate-ping';

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
      {pulse ? <span aria-hidden="true" className={ringClass} /> : null}
    </span>
  );
}
