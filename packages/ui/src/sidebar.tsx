import { Children, isValidElement, useId, type HTMLAttributes, type ReactNode } from 'react';
import { Badge } from './badge';
import { cn } from './cn';
import { cv } from './cv';
import { ResizeHandle } from './resize-handle';

// Left destination rail. Cloud, Soundboard and Flux each hand-built one with
// their own width (200 / 258 / dragged), so width is a prop rather than a
// constant: the content (four destinations vs. user-named boards) decides it.
//
// Layout: the root is a fixed-width column that never scrolls. Everything
// except `Footer` is collected into one body that scrolls, and `Footer` stays
// pinned under it (the same slot-extraction ListRow uses for Actions), so
// callers list Nav, Group and Footer in any order without wiring layout.
//
// Resizing reuses ResizeHandle in scalar mode on the trailing edge. It is
// absolutely positioned over the border so it takes no layout width. The
// sidebar is controlled: it reports `onWidthChange` and the caller stores it.
//
// Landmarks: the root is an `<aside>`; `Nav` is a named `<nav>`. `Group` is a
// labelled section whose label is a real heading, quiet and sentence case (no
// all-caps eyebrow).

const SIDEBAR_WIDTH = 220;
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;

const rootStyles = cv({
  base: 'relative flex min-h-0 shrink-0 flex-col border-r border-primary bg-secondary text-primary',
});

const bodyStyles = cv({
  // flex-1 + min-h-0: a flex child defaults to min-height:auto and would grow
  // to its content instead of shrinking and scrolling inside the column.
  base: 'flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-2',
});

const footerStyles = cv({
  base: 'shrink-0 border-t border-secondary p-2',
});

export interface SidebarProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children: ReactNode;
  /** Width in pixels. Default 220. */
  width?: number;
  /** Show a drag and keyboard handle on the trailing edge. Default false. */
  resizable?: boolean;
  /** Reports the next clamped width while resizing. */
  onWidthChange?: (width: number) => void;
  /** Smallest width the handle allows. Default 160. */
  min?: number;
  /** Largest width the handle allows. Default 400. */
  max?: number;
}

export interface SidebarNavProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Accessible name of the landmark. Default "Destinations". */
  'aria-label'?: string;
}

export interface SidebarGroupProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  children: ReactNode;
  /** Heading text. */
  label: ReactNode;
  /** Trailing count rendered as a Badge. */
  count?: number;
}

export interface SidebarFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

function Root({ children, width = SIDEBAR_WIDTH, resizable = false, onWidthChange, min = SIDEBAR_MIN, max = SIDEBAR_MAX, className, style, ...rest }: SidebarProps) {
  const body: ReactNode[] = [];
  const footer: ReactNode[] = [];
  for (const child of Children.toArray(children)) {
    if (isValidElement(child) && child.type === Footer) footer.push(child);
    else body.push(child);
  }

  return (
    <aside {...rest} style={{ ...style, width }} className={cn(rootStyles(), className)}>
      <div className={bodyStyles()}>{body}</div>
      {footer}
      {resizable ? (
        <div className="absolute inset-y-0 -right-px flex">
          <ResizeHandle orientation="horizontal" variant="hairline" label="Resize sidebar" value={width} min={min} max={max} onValueChange={onWidthChange} />
        </div>
      ) : null}
    </aside>
  );
}

function Nav({ children, 'aria-label': ariaLabel = 'Destinations', className, ...rest }: SidebarNavProps) {
  return (
    <nav {...rest} aria-label={ariaLabel} className={cn('flex flex-col gap-1', className)}>
      {children}
    </nav>
  );
}

function Group({ children, label, count, className, ...rest }: SidebarGroupProps) {
  const headingId = useId();
  return (
    <section {...rest} aria-labelledby={headingId} className={cn('flex flex-col gap-1', className)}>
      <div className="flex min-w-0 items-center justify-between gap-2 px-2">
        <h2 id={headingId} className="min-w-0 truncate label-xs text-tertiary">{label}</h2>
        {count === undefined ? null : <Badge size="sm">{count}</Badge>}
      </div>
      {children}
    </section>
  );
}

function Footer({ children, className, ...rest }: SidebarFooterProps) {
  return (
    <div {...rest} className={cn(footerStyles(), className)}>
      {children}
    </div>
  );
}

export const Sidebar = Object.assign(Root, { Nav, Group, Footer });
