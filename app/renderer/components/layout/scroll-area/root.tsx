import { forwardRef, useMemo, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';
import { cn } from '@renderer/utils/cn';
import { ScrollAreaActiveItemContext, type ScrollAreaActiveItemContextValue } from './context';

export type OverflowEdgeThreshold =
  | number
  | Partial<{ xStart: number; xEnd: number; yStart: number; yEnd: number }>;

export type ScrollPadding = number | `${number}%`;

export interface ScrollAreaRootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Threshold in pixels before the overflow-edge data attributes flip on. */
  overflowEdgeThreshold?: OverflowEdgeThreshold;
  /**
   * Padding (px or '%') applied when useScrollAreaActiveItem scrolls a child into view.
   * Custom to lumacast — Base UI does not ship this.
   */
  scrollPadding?: ScrollPadding;
  children?: ReactNode;
}

export const ScrollAreaRoot = forwardRef<HTMLDivElement, ScrollAreaRootProps>(function ScrollAreaRoot(
  { className, scrollPadding = 0, children, ...elementProps },
  forwardedRef,
) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Read at scroll-into-view time, so a changed prop needs no re-render of the subtree.
  const scrollPaddingRef = useRef<ScrollPadding>(scrollPadding);
  scrollPaddingRef.current = scrollPadding;

  const activeItemContext: ScrollAreaActiveItemContextValue = useMemo(
    () => ({ viewportRef, scrollPaddingRef }),
    [],
  );

  return (
    <ScrollAreaActiveItemContext.Provider value={activeItemContext}>
      <BaseScrollArea.Root
        {...elementProps}
        ref={forwardedRef}
        className={cn('relative size-full min-h-0', className)}
      >
        {children}
      </BaseScrollArea.Root>
    </ScrollAreaActiveItemContext.Provider>
  );
});
