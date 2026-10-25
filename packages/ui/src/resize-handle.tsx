import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from './cn';
import { cv } from './cv';

// ResizeHandle is the accessibility and interaction primitive behind every
// resizable split: a focusable ARIA separator that turns pointer drags and
// keyboard input into resize gestures. It never moves anything itself.
//
// `orientation` is the axis the panes are laid out along: 'horizontal' panes sit
// side by side, so the handle is a vertical rule (aria-orientation="vertical")
// operated with Left/Right. 'vertical' panes are stacked and use Up/Down.
//
// Two modes:
//   scalar - pass `value` (+ min/max). The handle reports the next clamped value
//            through `onValueChange` and exposes aria-valuenow/min/max.
//   delta  - omit `value`. Only `onResizeMove(delta)` is reported, for layouts
//            that redistribute space themselves (e.g. reorderable docks).
//
// Every gesture is `onResizeStart` -> `onResizeMove(delta)`* -> `onResizeEnd`.
// `delta` is cumulative from the gesture start, in pixels, positive along the
// reading axis (right/down) unless `reverse` flips it. A keyboard press is its
// own one-move gesture, so a consumer that snapshots in `onResizeStart` handles
// both inputs identically.

export type ResizeSource = 'pointer' | 'keyboard';

export interface ResizeHandleProps {
  orientation: 'horizontal' | 'vertical';
  value?: number;
  min?: number;
  max?: number;
  /** Keyboard step in pixels. Shift multiplies it by 10. */
  step?: number;
  /** Flip the drag and key direction (a panel on the trailing edge). */
  reverse?: boolean;
  variant?: 'rule' | 'hairline' | 'bar';
  label?: string;
  onValueChange?: (value: number) => void;
  onResizeStart?: (source: ResizeSource) => void;
  onResizeMove?: (delta: number) => void;
  onResizeEnd?: () => void;
  /** Enter, and double click: toggle collapse or restore a default. */
  onReset?: () => void;
  className?: string;
}

const handleStyles = cv({
  base: 'relative z-10 shrink-0 touch-none select-none outline-none transition-colors focus-visible:border-brand data-[dragging=true]:border-brand',
  variants: {
    orientation: {
      horizontal: 'cursor-ew-resize self-stretch',
      vertical: 'cursor-ns-resize',
    },
    variant: {
      rule: 'border-secondary hover:border-brand',
      hairline: 'border-secondary hover:border-brand',
      bar: 'border-transparent hover:border-brand',
    },
  },
  compoundVariants: [
    { orientation: 'horizontal', variant: 'rule', class: 'w-1 border-l-4' },
    { orientation: 'vertical', variant: 'rule', class: 'h-1 border-t-4' },
    { orientation: 'horizontal', variant: 'hairline', class: 'w-px border-l' },
    { orientation: 'vertical', variant: 'hairline', class: 'h-px border-t' },
    { orientation: 'horizontal', variant: 'bar', class: 'w-0.5 border-l-2' },
    { orientation: 'vertical', variant: 'bar', class: 'h-0.5 border-t-2' },
  ],
  defaultVariants: { orientation: 'horizontal', variant: 'rule' },
});

// Invisible pointer target that extends past the visible line.
const hitStyles = cv({
  base: 'absolute',
  variants: {
    orientation: { horizontal: 'inset-y-0', vertical: 'inset-x-0' },
    variant: { rule: '', hairline: '', bar: '' },
  },
  compoundVariants: [
    { orientation: 'horizontal', variant: 'rule', class: '-inset-x-0.5' },
    { orientation: 'vertical', variant: 'rule', class: '-inset-y-0.5' },
    { orientation: 'horizontal', variant: 'hairline', class: '-inset-x-[7.5px]' },
    { orientation: 'vertical', variant: 'hairline', class: '-inset-y-[7.5px]' },
    { orientation: 'horizontal', variant: 'bar', class: '-inset-x-0.5' },
    { orientation: 'vertical', variant: 'bar', class: '-inset-y-0.5' },
  ],
});

function clampValue(value: number, min?: number, max?: number) {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

export function ResizeHandle({
  orientation,
  value,
  min,
  max,
  step = 10,
  reverse = false,
  variant = 'rule',
  label,
  onValueChange,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  onReset,
  className,
}: ResizeHandleProps) {
  const isHorizontal = orientation === 'horizontal';
  const sign = reverse ? -1 : 1;
  const drag = useRef<{ origin: number; value: number | undefined } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Apply one cumulative delta from a gesture whose scalar baseline is `base`.
  const emit = (delta: number, base: number | undefined) => {
    onResizeMove?.(delta);
    if (base !== undefined) onValueChange?.(clampValue(base + delta, min, max));
  };

  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    onResizeEnd?.();
  };

  const keyGesture = (delta: number, base: number | undefined) => {
    onResizeStart?.('keyboard');
    emit(delta, base);
    onResizeEnd?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const decrease = isHorizontal ? 'ArrowLeft' : 'ArrowUp';
    const increase = isHorizontal ? 'ArrowRight' : 'ArrowDown';
    if (e.key === decrease || e.key === increase) {
      e.preventDefault();
      const amount = step * (e.shiftKey ? 10 : 1);
      // The key names a screen direction; `reverse` maps it onto the value.
      const delta = (e.key === increase ? amount : -amount) * sign;
      const base = value;
      const target = base === undefined ? undefined : clampValue(base + delta, min, max);
      keyGesture(target === undefined || base === undefined ? delta : target - base, base);
    } else if ((e.key === 'Home' || e.key === 'End') && value !== undefined) {
      const bound = e.key === 'Home' ? min : max;
      if (bound === undefined) return;
      e.preventDefault();
      keyGesture(bound - value, value);
    } else if (e.key === 'Enter' && onReset) {
      e.preventDefault();
      onReset();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button !== 0) return;
    drag.current = { origin: isHorizontal ? e.clientX : e.clientY, value };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    onResizeStart?.('pointer');
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const position = isHorizontal ? e.clientX : e.clientY;
    emit((position - current.origin) * sign, current.value);
  };

  const scalar = value !== undefined;
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
      aria-valuenow={scalar ? value : undefined}
      aria-valuemin={scalar ? min : undefined}
      aria-valuemax={scalar ? max : undefined}
      data-dragging={dragging}
      className={cn(handleStyles({ orientation, variant }), className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" className={hitStyles({ orientation, variant })} />
    </div>
  );
}
