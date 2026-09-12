import { forwardRef, type HTMLAttributes } from 'react';
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';
import { cn } from '@renderer/utils/cn';

export interface ScrollAreaScrollbarProps extends HTMLAttributes<HTMLDivElement> {
  /** Which axis the scrollbar controls. */
  orientation?: 'vertical' | 'horizontal';
  /** Keep the element mounted when the viewport isn't scrollable. */
  keepMounted?: boolean;
}

export const ScrollAreaScrollbar = forwardRef<HTMLDivElement, ScrollAreaScrollbarProps>(function ScrollAreaScrollbar(
  { className, orientation = 'vertical', keepMounted = false, ...elementProps },
  forwardedRef,
) {
  return (
    <BaseScrollArea.Scrollbar
      {...elementProps}
      ref={forwardedRef}
      orientation={orientation}
      keepMounted={keepMounted}
      className={cn(
        'flex touch-none select-none transition-opacity duration-150',
        // 10px interaction zone, but the thumb floats centered inside (see Thumb).
        orientation === 'vertical' ? 'w-2.5 justify-center' : 'h-2.5 items-center',
        // Overlay fade — visible only while the pointer is over the area or it is scrolling.
        'opacity-0 data-[hovering]:opacity-100 data-[scrolling]:opacity-100',
        className,
      )}
    />
  );
});
