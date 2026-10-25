import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { cv } from './cv';
import { Spinner } from './spinner';
import type { StatusTone } from './status-dot';

// Bottom-of-window status strip. The apps drifted between 28px and 21px; this
// uses 28px (h-7): the 12px label text fits with room, and interactive items
// keep a usable hit area (21px was too small to click).
//
// Landmark: a `<footer>` with an explicit contentinfo role (a footer nested in
// sectioning content would otherwise lose the role) and a name, so it is
// reachable by landmark navigation.
//
// Live regions: `Item` is NOT live by default. Status items (bitrate, timers,
// clocks) change every second or faster and would flood a screen reader. Pass
// `live` on the few items that report an event worth announcing (an operation
// starting or failing); that renders role="status" (polite, atomic).

const segmentStyles = cv({
  base: 'flex min-w-0 items-center gap-3',
  variants: {
    // Start and End take equal flexible space so Center is truly centred even
    // when the sides differ in width.
    place: {
      start: 'flex-1 justify-start',
      center: 'justify-center',
      end: 'flex-1 justify-end',
    },
  },
});

const itemStyles = cv({
  base: 'inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap label-xs',
  variants: {
    tone: {
      neutral: 'text-secondary',
      brand: 'text-brand',
      success: 'text-success',
      warning: 'text-warning',
      error: 'text-error',
    },
    interactive: {
      true: 'cursor-pointer rounded-sm px-1.5 py-0.5 outline-none transition-colors hover:bg-tertiary focus-visible:ring-2 focus-visible:ring-brand',
      false: '',
    },
  },
  defaultVariants: { tone: 'neutral', interactive: false },
});

export interface StatusBarProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children: ReactNode;
  /** Accessible name of the landmark. */
  label?: string;
}

function Root({ children, label = 'Status', className, ...rest }: StatusBarProps) {
  return (
    <footer
      role="contentinfo"
      aria-label={label}
      {...rest}
      className={cn('flex h-7 shrink-0 items-center gap-3 border-t border-primary bg-secondary px-3', className)}
    >
      {children}
    </footer>
  );
}

interface SegmentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

function Start({ className, ...rest }: SegmentProps) {
  return <div {...rest} className={cn(segmentStyles({ place: 'start' }), className)} />;
}

function Center({ className, ...rest }: SegmentProps) {
  return <div {...rest} className={cn(segmentStyles({ place: 'center' }), className)} />;
}

function End({ className, ...rest }: SegmentProps) {
  return <div {...rest} className={cn(segmentStyles({ place: 'end' }), className)} />;
}

export interface StatusBarItemProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick' | 'children'> {
  children: ReactNode;
  tone?: StatusTone;
  /** Shows a spinner before the content. */
  busy?: boolean;
  icon?: ReactNode;
  /** Makes the item a real button. Omit for plain text. */
  onClick?: () => void;
  /** Announce changes politely (role="status"). Off by default; see note above. */
  live?: boolean;
}

function Item({ children, tone = 'neutral', busy = false, icon, onClick, live = false, className, ...rest }: StatusBarItemProps) {
  const content = (
    <>
      {busy ? <Spinner size="xs" /> : icon}
      {children}
    </>
  );
  const styles = cn(itemStyles({ tone, interactive: Boolean(onClick) }), className);

  if (onClick) {
    return (
      <button {...(rest as HTMLAttributes<HTMLButtonElement>)} type="button" onClick={onClick} className={styles}>
        {content}
      </button>
    );
  }
  return (
    <span {...rest} role={live ? 'status' : rest.role} className={styles}>
      {content}
    </span>
  );
}

function Divider({ className }: { className?: string }) {
  return <span role="separator" aria-orientation="vertical" className={cn('h-3.5 w-px shrink-0 border-l border-primary', className)} />;
}

export const StatusBar = Object.assign(Root, { Start, Center, End, Item, Divider });
