import type { HTMLAttributes, ReactNode } from 'react';
import {
  TITLE_BAR_HEIGHT,
  TITLE_BAR_INSET_LEFT_DARWIN,
  TITLE_BAR_INSET_LEFT_OVERLAY,
  TITLE_BAR_INSET_RIGHT_OVERLAY,
} from '@lumacast/kernel';
import { cn } from './cn';

// Shared frame for a custom (frameless) window title bar. Only the invariant
// parts live here: drag behaviour and the platform insets. The menu strategy
// (native, hamburger, inline) is NOT a prop; each app puts its own menu in
// `Start`. App content (toolbars, LIVE/REC chips) goes in the slots too.
//
// The insets and height come from `@lumacast/kernel`, the same
// values the main process passes to Electron.

export type WindowChromePlatform = 'darwin' | 'win32' | 'linux';

export function detectWindowChromePlatform(): WindowChromePlatform {
  if (typeof navigator === 'undefined') return 'linux';
  const id = `${navigator.platform} ${navigator.userAgent}`;
  if (/mac/i.test(id)) return 'darwin';
  if (/win/i.test(id)) return 'win32';
  return 'linux';
}

// Drag regions: the bar is `drag`, so any interactive element inside it would
// be a dead zone unless it is `no-drag`. Start and End are `no-drag` as whole
// containers (the region is inherited by descendants), so consumers never
// mark individual buttons. They are content-sized, so they never cover the
// draggable Center. Center is `drag` by default, with `interactive` to opt in
// to `no-drag`. `draggable` on Start/End is the escape hatch for plain text.
const DRAG = '[-webkit-app-region:drag]';
const NO_DRAG = '[-webkit-app-region:no-drag]';

export interface WindowChromeProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children: ReactNode;
  /** Defaults to detecting from the user agent; pass it to be explicit or in tests. */
  platform?: WindowChromePlatform;
  /** Bar height in CSS pixels. Keep it equal to the main-process `titleBarOverlay.height`. */
  height?: number;
}

function Root({ children, platform, height = TITLE_BAR_HEIGHT, className, style, ...rest }: WindowChromeProps) {
  const resolved = platform ?? detectWindowChromePlatform();
  const darwin = resolved === 'darwin';
  return (
    <header
      {...rest}
      data-platform={resolved}
      className={cn('relative z-10 flex shrink-0 select-none items-center border-b border-secondary bg-primary', DRAG, className)}
      style={{
        height,
        minHeight: height,
        paddingLeft: darwin ? TITLE_BAR_INSET_LEFT_DARWIN : TITLE_BAR_INSET_LEFT_OVERLAY,
        paddingRight: darwin ? 12 : TITLE_BAR_INSET_RIGHT_OVERLAY,
        ...style,
      }}
    >
      {children}
    </header>
  );
}

interface EdgeSlotProps extends HTMLAttributes<HTMLDivElement> {
  /** Leave the slot as part of the drag region (text-only content). */
  draggable?: boolean;
}

function Start({ className, draggable = false, ...rest }: EdgeSlotProps) {
  return <div {...rest} data-slot="start" className={cn('flex h-full shrink-0 items-center gap-2', draggable ? DRAG : NO_DRAG, className)} />;
}

function End({ className, draggable = false, ...rest }: EdgeSlotProps) {
  return <div {...rest} data-slot="end" className={cn('ml-auto flex h-full shrink-0 items-center gap-2 pl-2', draggable ? DRAG : NO_DRAG, className)} />;
}

interface CenterProps extends HTMLAttributes<HTMLDivElement> {
  /** Make the centre interactive (for example a search field): it becomes `no-drag`. */
  interactive?: boolean;
}

function Center({ className, interactive = false, ...rest }: CenterProps) {
  return (
    <div
      {...rest}
      data-slot="center"
      className={cn('flex h-full min-w-0 flex-1 items-center justify-center truncate label-xs text-tertiary', interactive ? NO_DRAG : DRAG, className)}
    />
  );
}

export const WindowChrome = Object.assign(Root, { Start, Center, End });
