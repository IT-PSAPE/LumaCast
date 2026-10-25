import type { HTMLAttributes, ReactNode } from 'react';
import { Toolbar as BaseToolbar } from '@base-ui/react/toolbar';
import { cn } from './cn';
import { cv } from './cv';

// One height scale for action rows. The apps used 36/40/48/64 with no reason:
//   sm = 36px (h-9)  flux viewer toolbar (36) and flux header (40, rounded down)
//   md = 48px (h-12) chord bar (48) and cast/soundboard action rows
//   lg = 64px (h-16) stream's tall control strip (64)
// The `floating` variant is content-sized and ignores `size`.
//
// Built on Base UI's Toolbar (as ReacstButtonGroup is), so the buttons inside
// share one roving-tabindex tab stop. The `floating` treatment mirrors
// ReacstButtonGroup's pill so that component can later fold into this one.
//
// Deferred: `Overflow`. The apps solve overflow in different ways and it does
// not yet generalise.

const rootStyles = cv({
  base: 'flex items-center gap-2',
  variants: {
    size: { sm: 'h-9', md: 'h-12', lg: 'h-16' },
    variant: {
      plain: 'shrink-0 bg-secondary px-3',
      bordered: 'shrink-0 border-b border-primary bg-secondary px-3',
      floating: 'w-fit gap-0.5 rounded-lg border border-primary bg-tertiary/90 p-1 shadow-lg backdrop-blur-sm',
    },
  },
  compoundVariants: [{ variant: 'floating', class: 'h-auto' }],
  defaultVariants: { size: 'md', variant: 'plain' },
});

const segmentStyles = cv({
  base: 'flex min-w-0 items-center gap-2',
  variants: {
    // Start and End share free space equally so Center is truly centred.
    place: { start: 'flex-1 justify-start', center: 'justify-center', end: 'flex-1 justify-end' },
  },
});

export interface ToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'plain' | 'bordered' | 'floating';
  /** Accessible name of the toolbar. */
  label?: string;
}

function Root({ children, size = 'md', variant = 'plain', label, className, ...rest }: ToolbarProps) {
  return (
    <BaseToolbar.Root aria-label={label} {...rest} className={cn(rootStyles({ size, variant }), className)}>
      {children}
    </BaseToolbar.Root>
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

// A group draws its own leading rule when it directly follows another group,
// so callers never place separators between groups by hand.
const adjacentGroupRule = '[[data-toolbar-group]+&]:ml-1 [[data-toolbar-group]+&]:border-l [[data-toolbar-group]+&]:border-primary [[data-toolbar-group]+&]:pl-3';

export interface ToolbarGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  /** Accessible name for the group. */
  label?: string;
}

function Group({ children, label, className, ...rest }: ToolbarGroupProps) {
  return (
    <BaseToolbar.Group aria-label={label} data-toolbar-group="" {...rest} className={cn('flex items-center gap-1', adjacentGroupRule, className)}>
      {children}
    </BaseToolbar.Group>
  );
}

function Separator({ className }: { className?: string }) {
  return <BaseToolbar.Separator className={cn('h-5 w-px shrink-0 border-l border-primary', className)} />;
}

function Spacer({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('flex-1', className)} />;
}

export const Toolbar = Object.assign(Root, { Start, Center, End, Group, Separator, Spacer });
