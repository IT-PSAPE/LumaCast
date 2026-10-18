import { useSyncExternalStore, type ReactNode } from 'react';
import { OverlayStackContext } from '@lumacast/ui';

// A real, React-observable overlay stack for the confirm-dialog/dialog tests.
// The stack has to be real React-observable state, not a plain array: overlays
// register from an effect and only re-read `isTopmost` once that registration
// re-renders them.

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Base UI positioners measure through ResizeObserver and wait out popup
// transitions with getAnimations(); jsdom implements neither.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
}
if (typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = () => [];
}

const listeners = new Set<() => void>();
let stack: string[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function register(id: string) {
  if (stack.includes(id)) return;
  stack = [...stack, id];
  emit();
}

function unregister(id: string) {
  if (!stack.includes(id)) return;
  stack = stack.filter((entry) => entry !== id);
  emit();
}

export const overlayStackStore = {
  get entries() {
    return stack;
  },
  reset() {
    stack = [];
    emit();
  },
};

export function overlayRoot(): HTMLElement {
  const existing = document.getElementById('overlay-root');
  if (existing) return existing;
  const created = document.createElement('div');
  created.id = 'overlay-root';
  document.body.appendChild(created);
  return created;
}

/** Wraps `children` in a real `OverlayStackContext.Provider` (@lumacast/ui) backed by the module-level reactive stack above. For a component rendered under a `ContextMenu`/`Popover`/`Dialog` that reads `@lumacast/ui`'s overlay-stack hooks directly. */
export function WithOverlayStack({ children }: { children: ReactNode }) {
  const currentStack = useSyncExternalStore(subscribe, () => stack);
  return (
    <OverlayStackContext.Provider value={{ rootElement: overlayRoot(), stack: currentStack, baseZIndex: 9000, register, unregister }}>
      {children}
    </OverlayStackContext.Provider>
  );
}

/**
 * Stands in for `@renderer/contexts/workbench-context`'s `useWorkbench` via
 * `vi.mock('@renderer/contexts/workbench-context', () => import('./workbench-overlay-stack'))`
 * — for a component (e.g. `FieldSelect`) that still reads the overlay stack
 * through `useWorkbench()` rather than `@lumacast/ui` directly.
 */
export function useWorkbench() {
  return {
    state: {},
    actions: {},
    overlayStack: {
      rootElement: overlayRoot(),
      stack: useSyncExternalStore(subscribe, () => stack),
      baseZIndex: 9000,
      register,
      unregister,
    },
  };
}
