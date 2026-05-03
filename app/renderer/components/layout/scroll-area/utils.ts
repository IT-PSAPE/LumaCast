import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// SSR-safe useLayoutEffect (renderer is always client-side, but matches Base UI's pattern).
export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// A callback whose identity is stable but whose body always sees the latest closure values.
export function useStableCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const ref = useRef(callback);
  useIsoLayoutEffect(() => {
    ref.current = callback;
  });
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}

// A managed setTimeout that auto-clears on unmount.
export function useTimeout() {
  const idRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = useCallback(() => {
    if (idRef.current !== null) {
      clearTimeout(idRef.current);
      idRef.current = null;
    }
  }, []);
  const start = useCallback(
    (delay: number, fn: () => void) => {
      clear();
      idRef.current = setTimeout(() => {
        idRef.current = null;
        fn();
      }, delay);
    },
    [clear],
  );
  useEffect(() => clear, [clear]);
  return { start, clear };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Tolerance for treating sub-pixel rubber-band offsets as edges (matches Base UI).
const SCROLL_EDGE_TOLERANCE_PX = 1;

export function normalizeScrollOffset(value: number, max: number): number {
  if (max <= 0) return 0;
  const clamped = clamp(value, 0, max);
  const startDistance = clamped;
  const endDistance = max - clamped;
  const withinStart = startDistance <= SCROLL_EDGE_TOLERANCE_PX;
  const withinEnd = endDistance <= SCROLL_EDGE_TOLERANCE_PX;
  if (withinStart && withinEnd) return startDistance <= endDistance ? 0 : max;
  if (withinStart) return 0;
  if (withinEnd) return max;
  return clamped;
}

// Read a single-axis margin/padding offset in pixels.
// Mirrors Base UI's getOffset, including the Safari `marginInlineEnd` workaround.
export function getOffset(
  element: Element | null,
  prop: 'margin' | 'padding',
  axis: 'x' | 'y',
): number {
  if (!element) return 0;
  const styles = getComputedStyle(element);
  if (axis === 'x' && prop === 'margin') {
    return parseFloat(styles.marginInlineStart) * 2;
  }
  const propAxis = axis === 'x' ? 'Inline' : 'Block';
  const startKey = `${prop}${propAxis}Start` as 'marginInlineStart';
  const endKey = `${prop}${propAxis}End` as 'marginInlineEnd';
  return parseFloat(styles[startKey]) + parseFloat(styles[endKey]);
}

export function contains(parent: Node | null | undefined, child: Node | null | undefined): boolean {
  if (!parent || !child) return false;
  return parent === child || parent.contains(child);
}

// Merge multiple refs into a single ref callback.
export function mergeRefs<T>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(value);
      else (ref as React.MutableRefObject<T | null>).current = value;
    }
  };
}

// Inject a global stylesheet rule that hides native scrollbars on opted-in elements.
// Done once per page; React 19 could hoist a <style> tag but this keeps the rule
// owned by the scroll-area module so deletions/edits stay local.
export const HIDE_NATIVE_SCROLLBAR_CLASS = 'lumacast-scroll-area-hide-native';

let hideScrollbarStylesInjected = false;
export function ensureHideScrollbarStyles(): void {
  if (hideScrollbarStylesInjected || typeof document === 'undefined') return;
  hideScrollbarStylesInjected = true;
  const style = document.createElement('style');
  style.dataset.lumacastScrollArea = 'hide-native-scrollbar';
  style.textContent = `
    .${HIDE_NATIVE_SCROLLBAR_CLASS} {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .${HIDE_NATIVE_SCROLLBAR_CLASS}::-webkit-scrollbar {
      display: none;
    }
  `;
  document.head.appendChild(style);
}

export const SCROLL_TIMEOUT = 500;
export const MIN_THUMB_SIZE = 16;

export const DEFAULT_COORDS = { x: 0, y: 0 };
export const DEFAULT_SIZE = { width: 0, height: 0 };
export const DEFAULT_OVERFLOW_EDGES = { xStart: false, xEnd: false, yStart: false, yEnd: false };
export const DEFAULT_HIDDEN_STATE = { x: true, y: true, corner: true };

export type Coords = typeof DEFAULT_COORDS;
export type Size = typeof DEFAULT_SIZE;
export type OverflowEdges = typeof DEFAULT_OVERFLOW_EDGES;
export type HiddenState = typeof DEFAULT_HIDDEN_STATE;
