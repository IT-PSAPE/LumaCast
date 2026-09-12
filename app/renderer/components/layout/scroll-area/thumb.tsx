import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import { cn } from '@renderer/utils/cn';
import { useScrollAreaRootContext, useScrollAreaScrollbarContext } from './context';
import { mergeRefs } from './utils';

export interface ScrollAreaThumbProps extends HTMLAttributes<HTMLDivElement> {}

export const ScrollAreaThumb = forwardRef<HTMLDivElement, ScrollAreaThumbProps>(function ScrollAreaThumb(
  { className, style, onPointerDown, onPointerMove, onPointerUp, ...elementProps },
  forwardedRef,
) {
  const {
    thumbYRef,
    thumbXRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    setScrollingX,
    setScrollingY,
    hasMeasuredScrollbar,
  } = useScrollAreaRootContext();

  const { orientation } = useScrollAreaScrollbarContext();

  const baseStyle: CSSProperties = {
    visibility: hasMeasuredScrollbar ? undefined : 'hidden',
    ...(orientation === 'vertical'
      ? { height: 'var(--scroll-area-thumb-height)' }
      : { width: 'var(--scroll-area-thumb-width)' }),
    ...style,
  };

  return (
    <div
      {...elementProps}
      ref={mergeRefs(forwardedRef, orientation === 'vertical' ? thumbYRef : thumbXRef)}
      data-orientation={orientation}
      className={cn(
        'rounded-full bg-(--text-color-tertiary)/50 hover:bg-(--text-color-tertiary)/80',
        // Thin floating thumb — narrower than its scrollbar so the track reads as empty space.
        orientation === 'vertical' ? 'w-1' : 'h-1',
        className,
      )}
      style={baseStyle}
      onPointerDown={(e) => {
        handlePointerDown(e);
        onPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        handlePointerMove(e);
        onPointerMove?.(e);
      }}
      onPointerUp={(e) => {
        if (orientation === 'vertical') setScrollingY(false);
        else setScrollingX(false);
        handlePointerUp(e);
        onPointerUp?.(e);
      }}
    />
  );
});
