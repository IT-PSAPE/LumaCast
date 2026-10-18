import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';

// Domain-agnostic overlay stack: a shared portal root plus a FIFO of open
// overlay ids, used to z-order concurrently open overlays (a dialog that opens
// a nested context menu, a picker that spawns an upload dialog) and to tell
// the topmost one apart from its siblings — only it should respond to Escape.
// Promoted from LumaCast's `renderer/contexts/workbench-context.tsx` (#?) so
// every surface (Cast, Stream, Cloud, Flux) can share one implementation.

const DEFAULT_OVERLAY_ROOT_ID = 'overlay-root';
const DEFAULT_BASE_Z_INDEX = 1;

export interface OverlayStackValue {
  rootElement: HTMLElement | null;
  stack: string[];
  baseZIndex: number;
  register: (id: string) => void;
  unregister: (id: string) => void;
}

function ensureOverlayRoot(rootId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById(rootId);
  if (existing) return existing;
  const root = document.createElement('div');
  root.id = rootId;
  document.body.append(root);
  return root;
}

/**
 * Creates the state behind a document-wide overlay stack. Call once near the
 * root of an app's tree and provide the result via
 * `OverlayStackContext.Provider` — or use `OverlayStackProvider` below, which
 * does both. An app with no provider still works: `useOverlayContainer` and
 * `useOverlayStackEntry` degrade to a sane single-overlay default (see there).
 */
export function useOverlayStack(options?: { rootId?: string; baseZIndex?: number }): OverlayStackValue {
  const rootId = options?.rootId ?? DEFAULT_OVERLAY_ROOT_ID;
  const baseZIndex = options?.baseZIndex ?? DEFAULT_BASE_Z_INDEX;
  const [rootElement] = useState<HTMLElement | null>(() => ensureOverlayRoot(rootId));
  const [stack, setStack] = useState<string[]>([]);

  const register = useCallback((id: string) => {
    setStack((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const unregister = useCallback((id: string) => {
    setStack((prev) => {
      const next = prev.filter((entryId) => entryId !== id);
      return next.length === prev.length ? prev : next;
    });
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    if (stack.length > 0) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [stack.length]);

  return useMemo<OverlayStackValue>(() => ({
    rootElement,
    stack,
    baseZIndex,
    register,
    unregister,
  }), [rootElement, stack, baseZIndex, register, unregister]);
}

export const OverlayStackContext = createContext<OverlayStackValue | null>(null);

/** Convenience wrapper around `useOverlayStack` for an app that has no other reason to own the stack state itself. */
export function OverlayStackProvider({ children, rootId, baseZIndex }: { children: ReactNode; rootId?: string; baseZIndex?: number }) {
  const value = useOverlayStack({ rootId, baseZIndex });
  return <OverlayStackContext.Provider value={value}>{children}</OverlayStackContext.Provider>;
}

/**
 * The overlay portal container. `undefined` lets a Base UI portal fall back to
 * `<body>` when no `OverlayStackProvider` is mounted — correct for an app that
 * never needs to coordinate stacking across independent overlay roots.
 */
export function useOverlayContainer(): HTMLElement | undefined {
  const context = useContext(OverlayStackContext);
  return context?.rootElement ?? (typeof document === 'undefined' ? undefined : document.getElementById(DEFAULT_OVERLAY_ROOT_ID) ?? undefined);
}

/**
 * Registers an open overlay with the nearest `OverlayStackProvider`, if any,
 * and reports where it sits. `zIndex` paints it above whatever opened it;
 * `isTopmost` gates Escape, because separate Base UI roots (a picker and the
 * upload dialog it spawns) are siblings that only the stack can order. Without
 * a provider every overlay is its own stack of one: always topmost, always at
 * the default base z-index — correct for an app that never layers independent
 * overlay roots over one another.
 */
export function useOverlayStackEntry(isOpen: boolean): { isTopmost: boolean; zIndex: number } {
  const context = useContext(OverlayStackContext);
  const overlayId = useId();
  const register = context?.register;
  const unregister = context?.unregister;

  useEffect(() => {
    if (!isOpen || !register || !unregister) return undefined;
    register(overlayId);
    return () => unregister(overlayId);
  }, [isOpen, overlayId, register, unregister]);

  if (!context) {
    return { isTopmost: true, zIndex: DEFAULT_BASE_Z_INDEX };
  }

  const index = context.stack.indexOf(overlayId);
  return {
    isTopmost: index >= 0 && index === context.stack.length - 1,
    zIndex: context.baseZIndex + Math.max(index, 0) * 10,
  };
}
