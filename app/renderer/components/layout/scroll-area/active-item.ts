import { useEffect, useRef } from 'react';
import { useScrollAreaRootContext } from './context';
import type { ScrollPadding } from './root';

/**
 * Returns a ref that, when attached to an element, scrolls that element into the
 * surrounding ScrollArea.Viewport whenever `isActive` becomes true. Optional
 * scroll padding is read from <ScrollArea.Root scrollPadding={...}>.
 *
 * Custom to lumacast — Base UI's scroll-area does not ship this hook.
 */
export function useScrollAreaActiveItem<T extends HTMLElement = HTMLDivElement>(isActive: boolean) {
  const { viewportRef, scrollPaddingRef } = useScrollAreaRootContext();
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!isActive) return;
    const element = ref.current;
    const container = viewportRef.current;
    if (!element || !container) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const padding = resolvePadding(scrollPaddingRef.current, containerRect.height);

    const above = elementRect.top < containerRect.top + padding;
    const below = elementRect.bottom > containerRect.bottom - padding;
    if (!above && !below) return;

    const delta = above
      ? elementRect.top - containerRect.top - padding
      : elementRect.bottom - containerRect.bottom + padding;
    container.scrollBy({ top: delta });
  }, [isActive, viewportRef, scrollPaddingRef]);

  return ref;
}

function resolvePadding(padding: ScrollPadding, containerHeight: number): number {
  if (typeof padding === 'number') return padding;
  const numeric = parseFloat(padding);
  if (Number.isNaN(numeric)) return 0;
  return (numeric / 100) * containerHeight;
}
