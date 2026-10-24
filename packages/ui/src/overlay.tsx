import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react';

// Domain-agnostic overlay stack: a shared portal root plus a FIFO of open
// overlay ids, used to z-order concurrently open overlays (a dialog that opens
// a nested context menu, a picker that spawns an upload dialog) and to tell
// the topmost one apart from its siblings — only it should respond to Escape.
// Promoted from LumaCast's `renderer/contexts/workbench-context.tsx` (#?) so
// every surface (Cast, Stream, Cloud, Flux) can share one implementation.

const DEFAULT_OVERLAY_ROOT_ID = 'overlay-root';
// The one z-index scale for every overlay in the package (JS owns it; no
// component or stylesheet hardcodes its own). Each open overlay occupies a
// slot of OVERLAY_SLOT_STEP: a modal backdrop sits at the slot base and its
// popup at base + 1, so a later overlay's backdrop covers an earlier popup.
// With a provider, slots follow open order (base + index * step), so whatever
// opens later is above. Without one, a static ladder by layer applies.
const DEFAULT_BASE_Z_INDEX = 50;
const OVERLAY_SLOT_STEP = 10;
export type OverlayLayer = 'modal' | 'popup' | 'tooltip';
const STATIC_LAYER_SLOT: Record<OverlayLayer, number> = { modal: 0, popup: 1, tooltip: 2 };
const STATIC_TOAST_SLOT = 3;

/** Popup-level z-index of an overlay layer when no provider orders it (modal 51, popup 61, tooltip 71). */
export const STATIC_OVERLAY_Z_INDEX: Record<OverlayLayer, number> = {
  modal: DEFAULT_BASE_Z_INDEX + STATIC_LAYER_SLOT.modal * OVERLAY_SLOT_STEP + 1,
  popup: DEFAULT_BASE_Z_INDEX + STATIC_LAYER_SLOT.popup * OVERLAY_SLOT_STEP + 1,
  tooltip: DEFAULT_BASE_Z_INDEX + STATIC_LAYER_SLOT.tooltip * OVERLAY_SLOT_STEP + 1,
};

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
 * the static layer ladder — correct for an app that never layers independent
 * overlay roots over one another.
 */
export function useOverlayStackEntry(
  isOpen: boolean,
  layer: OverlayLayer = 'popup',
): { isTopmost: boolean; zIndex: number; backdropZIndex: number } {
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
    const zIndex = STATIC_OVERLAY_Z_INDEX[layer];
    return { isTopmost: true, zIndex, backdropZIndex: zIndex - 1 };
  }

  const index = context.stack.indexOf(overlayId);
  // Before the registering effect has run, an open overlay is about to be
  // appended, so slot it at the end rather than at the bottom.
  const slot = index >= 0 ? index : isOpen ? context.stack.length : 0;
  const zIndex = context.baseZIndex + slot * OVERLAY_SLOT_STEP + 1;
  return {
    isTopmost: index >= 0 && index === context.stack.length - 1,
    zIndex,
    backdropZIndex: zIndex - 1,
  };
}

/** Z-index for the toast region: above every open overlay, and above the static ladder without a provider. */
export function useToastZIndex(): number {
  const context = useContext(OverlayStackContext);
  if (!context) return DEFAULT_BASE_Z_INDEX + STATIC_TOAST_SLOT * OVERLAY_SLOT_STEP + 1;
  return context.baseZIndex + context.stack.length * OVERLAY_SLOT_STEP + 1;
}
