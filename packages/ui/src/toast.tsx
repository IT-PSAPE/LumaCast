import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { cv } from './cv';
import { useOverlayContainer, useToastZIndex } from './overlay';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  title?: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds; `null` never auto-dismisses. Default 5000, except errors, which default to `null`. */
  duration?: number | null;
  action?: { label: string; onClick: () => void };
  /** An existing id replaces that toast in place instead of stacking a duplicate. */
  id?: string;
}

export interface ToasterProps {
  position?: 'top-right' | 'top-center' | 'bottom-right' | 'bottom-center';
  max?: number;
  className?: string;
}

interface ToastEntry {
  id: string;
  title?: string;
  description?: string;
  tone: ToastTone;
  duration: number | null;
  action?: { label: string; onClick: () => void };
  /** Bumped on every replace so the dismiss timer restarts. */
  revision: number;
  closing: boolean;
}

const DEFAULT_DURATION = 5000;
const EXIT_MS = 160;

// Module-level store: `toast()` works from anywhere, and `useSyncExternalStore`
// keeps `Toaster` in step. `max` is applied by the mounted Toaster.
let entries: readonly ToastEntry[] = [];
let sequence = 0;
let mountedToasters = 0;
let warnedNoToaster = false;
let maxVisible = 4;
const listeners = new Set<() => void>();

function commit(next: readonly ToastEntry[]): void {
  entries = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly ToastEntry[] {
  return entries;
}

function capEntries(list: readonly ToastEntry[]): readonly ToastEntry[] {
  const live = list.filter((entry) => !entry.closing);
  const excess = live.length - maxVisible;
  if (excess <= 0) return list;
  const dropped = new Set(live.slice(0, excess).map((entry) => entry.id));
  return list.filter((entry) => !dropped.has(entry.id));
}

function isDevelopment(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}

function pushToast(options: ToastOptions): string {
  if (mountedToasters === 0 && !warnedNoToaster && isDevelopment()) {
    warnedNoToaster = true;
    console.warn('[ui] toast() called but no <Toaster /> is mounted; the toast will not be shown until one is.');
  }
  const tone = options.tone ?? 'info';
  const id = options.id ?? `toast-${(sequence += 1)}`;
  const existing = entries.find((entry) => entry.id === id);
  const entry: ToastEntry = {
    id,
    title: options.title,
    description: options.description,
    tone,
    duration: options.duration !== undefined ? options.duration : tone === 'error' ? null : DEFAULT_DURATION,
    action: options.action,
    revision: (existing?.revision ?? 0) + 1,
    closing: false,
  };
  commit(capEntries(existing ? entries.map((item) => (item.id === id ? entry : item)) : [...entries, entry]));
  return id;
}

function removeToast(id: string): void {
  if (entries.some((entry) => entry.id === id)) commit(entries.filter((entry) => entry.id !== id));
}

function dismissToast(id: string): void {
  if (!entries.some((entry) => entry.id === id && !entry.closing)) return;
  commit(entries.map((entry) => (entry.id === id ? { ...entry, closing: true } : entry)));
}

function dismissAllToasts(): void {
  if (entries.length === 0) return;
  commit(entries.map((entry) => (entry.closing ? entry : { ...entry, closing: true })));
}

export function useToast(): {
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
} {
  return { toast: pushToast, dismiss: dismissToast, dismissAll: dismissAllToasts };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const toastClass = cv({
  base: [
    'pointer-events-auto flex items-start gap-2.5 rounded-container border bg-primary px-3 py-2.5 text-secondary shadow-lg',
    'motion-safe:transition-[opacity,transform] motion-safe:duration-150 motion-safe:ease-out',
  ],
  variants: {
    tone: {
      info: 'border-primary',
      success: 'border-success/40',
      warning: 'border-warning/40',
      error: 'border-error/40',
    },
    shown: {
      true: 'translate-y-0 opacity-100',
      false: 'translate-y-1 opacity-0',
    },
  },
  defaultVariants: { tone: 'info', shown: 'false' },
});

const iconClass: Record<ToastTone, string> = {
  info: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
};

const iconPaths: Record<ToastTone, ReactElement> = {
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </>
  ),
  success: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  warning: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
};

function ToastIcon({ paths, className }: { paths: ReactElement; className: string }): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths}
    </svg>
  );
}

function ToastItem({ entry }: { entry: ToastEntry }): ReactElement {
  const [shown, setShown] = useState(false);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef<number | null>(entry.duration);
  const { id, duration, revision, closing } = entry;

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(true);
      return undefined;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // A replace (new revision) restarts the full duration.
  useEffect(() => {
    remainingRef.current = duration;
  }, [duration, revision]);

  useEffect(() => {
    if (closing || paused || duration === null) return undefined;
    const remaining = remainingRef.current ?? duration;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismissToast(id), remaining);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remaining - (Date.now() - startedAt));
    };
  }, [id, duration, revision, closing, paused]);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = setTimeout(() => removeToast(id), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => clearTimeout(timer);
  }, [id, closing]);

  // Only errors interrupt a screen reader; info, success and warning are polite (matches Banner).
  const urgent = entry.tone === 'error';

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={toastClass({ tone: entry.tone, shown: shown && !closing })}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <ToastIcon paths={iconPaths[entry.tone]} className={cn('mt-0.5 shrink-0', iconClass[entry.tone])} />
      <div className="min-w-0 flex-1">
        {entry.title && <p className="label-sm text-primary">{entry.title}</p>}
        {entry.description && (
          <p className={cn('paragraph-sm whitespace-pre-wrap break-words', entry.title ? 'text-tertiary' : 'text-secondary')}>
            {entry.description}
          </p>
        )}
        {entry.action && (
          <button
            type="button"
            onClick={() => {
              entry.action?.onClick();
              dismissToast(id);
            }}
            className="label-sm mt-1.5 cursor-pointer rounded-control text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {entry.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(id)}
        className="shrink-0 cursor-pointer rounded-control p-0.5 text-tertiary hover:bg-tertiary hover:text-primary focus-visible:outline-2 focus-visible:outline-brand"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}

const positionClass: Record<NonNullable<ToasterProps['position']>, string> = {
  'top-right': 'top-4 right-4 flex-col-reverse',
  'top-center': 'top-4 left-1/2 -translate-x-1/2 flex-col-reverse',
  'bottom-right': 'bottom-4 right-4 flex-col',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2 flex-col',
};

export function Toaster({ position = 'bottom-right', max = 4, className }: ToasterProps): ReactElement {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const container = useOverlayContainer();

  useEffect(() => {
    mountedToasters += 1;
    return () => {
      mountedToasters -= 1;
    };
  }, []);

  useEffect(() => {
    maxVisible = Math.max(1, max);
    commit(capEntries(entries));
  }, [max]);

  // Above every open overlay (scale owned by overlay.tsx).
  const zIndex = useToastZIndex();

  const region = (
    <section
      aria-label="Notifications"
      style={{ zIndex }}
      className={cn(
        'pointer-events-none fixed flex w-80 max-w-[calc(100vw-2rem)] gap-2',
        positionClass[position],
        className,
      )}
    >
      {list.map((entry) => (
        <ToastItem key={entry.id} entry={entry} />
      ))}
    </section>
  );

  return container ? createPortal(region, container) : region;
}
