import { forwardRef, type HTMLAttributes } from 'react';
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';
import { cn } from '@renderer/utils/cn';

export interface ScrollAreaThumbProps extends HTMLAttributes<HTMLDivElement> {}

export const ScrollAreaThumb = forwardRef<HTMLDivElement, ScrollAreaThumbProps>(function ScrollAreaThumb(
  { className, ...elementProps },
  forwardedRef,
) {
  return (
    <BaseScrollArea.Thumb
      {...elementProps}
      ref={forwardedRef}
      className={cn(
        'rounded-full bg-(--text-color-tertiary)/50 hover:bg-(--text-color-tertiary)/80',
        // Thin floating thumb — narrower than its scrollbar so the track reads as empty space.
        'data-[orientation=vertical]:w-1 data-[orientation=horizontal]:h-1',
        className,
      )}
    />
  );
});
