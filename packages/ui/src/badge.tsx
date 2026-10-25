import type { ReactNode } from 'react';
import { cn } from './cn';
import { cv } from './cv';
import { StatusDot, type StatusTone } from './status-dot';

// OPEN DECISION (for a human): live/recording/idle colour semantics conflict
// across the apps. These components bake in NO such meaning; tones are plain
// colours and call sites choose. Conflicting usages found in the audit:
//   1. apps/stream/renderer/chrome/title-bar.css (.title-bar-chip, used by
//      App.tsx for LIVE and REC): live/recording = --color-error (red).
//   2. apps/stream/renderer/style.css (.live-tag, used by
//      docks/scenes-dock.tsx for LIVE): live = --color-success (green).
//   3. apps/cast/renderer/features/workbench/status-bar.tsx (and
//      app-toolbar.tsx): live = bg-success, idle = bg-error (inverted again).
//
// Standardised treatment: `soft` tints at 15% (matches Button `take`/`danger`
// and cloud's StatusPill, replacing the 10/15/20% spread). Default shape is
// `pill` (rounded-full); `rounded` is rounded-sm, the radius cast chips and
// Select use. Colours come only from semantic tokens.

const badgeStyles = cv({
  base: 'inline-flex w-fit shrink-0 items-center whitespace-nowrap label-xs',
  variants: {
    size: {
      sm: 'gap-1 px-2 py-0.5',
      md: 'gap-1.5 px-2.5 py-1',
    },
    shape: {
      pill: 'rounded-full',
      rounded: 'rounded-sm',
    },
    tone: {
      neutral: '',
      brand: '',
      success: '',
      warning: '',
      error: '',
    },
    variant: {
      soft: '',
      solid: '',
      outline: 'border',
    },
  },
  compoundVariants: [
    { variant: 'soft', tone: 'neutral', class: 'bg-tertiary text-secondary' },
    { variant: 'soft', tone: 'brand', class: 'bg-brand/15 text-brand' },
    { variant: 'soft', tone: 'success', class: 'bg-success/15 text-success' },
    { variant: 'soft', tone: 'warning', class: 'bg-warning/15 text-warning' },
    { variant: 'soft', tone: 'error', class: 'bg-error/15 text-error' },
    { variant: 'solid', tone: 'neutral', class: 'bg-tertiary text-primary' },
    { variant: 'solid', tone: 'brand', class: 'bg-brand text-white' },
    { variant: 'solid', tone: 'success', class: 'bg-success text-white' },
    { variant: 'solid', tone: 'warning', class: 'bg-warning text-white' },
    { variant: 'solid', tone: 'error', class: 'bg-error text-white' },
    { variant: 'outline', tone: 'neutral', class: 'border-current bg-transparent text-secondary' },
    { variant: 'outline', tone: 'brand', class: 'border-brand bg-transparent text-brand' },
    { variant: 'outline', tone: 'success', class: 'border-success bg-transparent text-success' },
    { variant: 'outline', tone: 'warning', class: 'border-warning bg-transparent text-warning' },
    { variant: 'outline', tone: 'error', class: 'border-error bg-transparent text-error' },
  ],
  defaultVariants: { tone: 'neutral', variant: 'soft', size: 'sm', shape: 'pill' },
});

export interface BadgeProps {
  children: ReactNode;
  tone?: StatusTone;
  variant?: 'soft' | 'solid' | 'outline';
  size?: 'sm' | 'md';
  shape?: 'pill' | 'rounded';
  /** Leading StatusDot in the same tone. */
  dot?: boolean;
  /** Attention pulse on the leading dot. Requires `dot`; respects prefers-reduced-motion. */
  pulse?: boolean;
  icon?: ReactNode;
  className?: string;
}

export function Badge({ children, tone = 'neutral', variant, size, shape, dot = false, pulse = false, icon, className }: BadgeProps) {
  // On a solid fill the same-tone dot would vanish, so it renders as currentColor.
  const dotOnSolid = variant === 'solid';
  return (
    <span className={cn(badgeStyles({ tone, variant, size, shape }), className)}>
      {dot ? <StatusDot tone={tone} pulse={pulse} className={dotOnSolid ? 'bg-current' : undefined} /> : null}
      {icon ? <span aria-hidden="true" className="inline-flex shrink-0">{icon}</span> : null}
      {children}
    </span>
  );
}
