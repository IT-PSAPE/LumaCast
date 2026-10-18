import { useSyncExternalStore, type ReactNode } from 'react';
import { OverlayStackContext } from '@lumacast/ui';

// A real, React-observable overlay stack for tests that exercise actual
// multi-overlay behavior (stacking order, outside-press interaction between
// sibling overlays) rather than relying on the single-overlay default
// `useOverlayContainer`/`useOverlayStackEntry` fall back to with no provider.

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

/** Wraps `children` in a real `OverlayStackContext.Provider` backed by the module-level reactive stack above. */
export function WithOverlayStack({ children }: { children: ReactNode }) {
  const currentStack = useSyncExternalStore(subscribe, () => stack);
  return (
    <OverlayStackContext.Provider value={{ rootElement: overlayRoot(), stack: currentStack, baseZIndex: 9000, register, unregister }}>
      {children}
    </OverlayStackContext.Provider>
  );
}
