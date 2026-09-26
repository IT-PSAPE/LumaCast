import { createContext, useContext, type RefObject } from 'react';
import type { ScrollPadding } from './root';

/**
 * Lumacast-only context layered on Base UI's scroll area. Base UI owns every
 * scrollbar/thumb/overflow concern internally; the only thing it does not expose
 * is the viewport element, which `useScrollAreaActiveItem` needs to scroll a
 * child into view.
 */
export interface ScrollAreaActiveItemContextValue {
  viewportRef: RefObject<HTMLDivElement | null>;
  scrollPaddingRef: RefObject<ScrollPadding>;
}

export const ScrollAreaActiveItemContext = createContext<ScrollAreaActiveItemContextValue | undefined>(undefined);

export function useScrollAreaActiveItemContext(): ScrollAreaActiveItemContextValue {
  const ctx = useContext(ScrollAreaActiveItemContext);
  if (!ctx) {
    throw new Error('ScrollArea parts must be placed within <ScrollArea.Root>.');
  }
  return ctx;
}
