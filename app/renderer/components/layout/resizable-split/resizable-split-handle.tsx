import type { PointerEventHandler } from 'react';
import { cv } from '@renderer/utils/cv';

const TOUCH_SIZE = 16;
const HALF_TOUCH_SIZE = TOUCH_SIZE / 2;

const touchStyles = cv({
  base: 'absolute z-20 touch-none',
  variants: {
    orientation: {
      horizontal: ['top-0 bottom-0 w-4 cursor-ew-resize'],
      vertical: ['left-0 right-0 h-4 cursor-ns-resize'],
    },
  },
});

const lineStyles = cv({
  base: 'pointer-events-none absolute transition-colors',
  variants: {
    orientation: {
      horizontal: ['top-0 bottom-0 left-1/2 w-px -translate-x-1/2'],
      vertical: ['left-0 right-0 top-1/2 h-px -translate-y-1/2'],
    },
    highlighted: {
      true: ['bg-brand'],
      false: ['bg-transparent'],
    },
  },
  defaultVariants: {
    highlighted: false,
  },
});

interface ResizableSplitHandleProps {
  orientation: 'horizontal' | 'vertical';
  handleIndex: number;
  position: number;
  active: boolean;
  hovered: boolean;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onPointerEnter: PointerEventHandler<HTMLDivElement>;
  onPointerLeave: PointerEventHandler<HTMLDivElement>;
}

export function ResizableSplitHandle({
  orientation,
  handleIndex,
  position,
  active,
  hovered,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerEnter,
  onPointerLeave,
}: ResizableSplitHandleProps) {
  const isHorizontal = orientation === 'horizontal';
  const style = isHorizontal
    ? { left: `${position - HALF_TOUCH_SIZE}px` }
    : { top: `${position - HALF_TOUCH_SIZE}px` };

  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      data-handle-index={handleIndex}
      className={touchStyles({ orientation })}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className={lineStyles({ orientation, highlighted: active || hovered })} />
    </div>
  );
}

export type { ResizableSplitHandleProps };
