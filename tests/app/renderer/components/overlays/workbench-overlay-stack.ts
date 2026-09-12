import { useSyncExternalStore } from 'react';

// Stands in for `@renderer/contexts/workbench-context` in the overlay tests.
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
