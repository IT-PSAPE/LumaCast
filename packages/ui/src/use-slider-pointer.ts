import type { Slider as BaseSlider } from '@base-ui/react/slider';
import { useDirection } from '@base-ui/react/direction-provider';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSliderFocus } from './use-slider-focus';

interface PointerOptions {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  orientation?: 'horizontal' | 'vertical';
  disabled?: boolean;
  readOnly?: boolean;
  interactionKey?: string;
  onValueChange: (value: number) => void;
  onCommit?: (value: number) => void;
  onCancel?: () => void;
}

interface Gesture {
  pointerId: number;
  control: HTMLDivElement;
  interactionKey?: string;
  offset: number;
  value: number;
  changed: boolean;
  geometry: { left: number; top: number; width: number; height: number };
}

function precision(value: number) {
  const [mantissa, exponent = '0'] = String(value).split('e');
  return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
}

export function useSliderPointer({
  value,
  min = 0,
  max = 100,
  step = 1,
  orientation = 'horizontal',
  disabled = false,
  readOnly = false,
  interactionKey,
  onValueChange,
  onCommit,
  onCancel,
}: PointerOptions) {
  const direction = useDirection();
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const cancelCallback = useRef(onCancel);
  useLayoutEffect(() => {
    cancelCallback.current = onCancel;
  }, [onCancel]);
  const [dragging, setDragging] = useState(false);
  const focus = useSliderFocus();
  const release = useCallback((updateState = true) => {
    const current = gesture.current;
    gesture.current = null;
    if (updateState) setDragging(false);
    if (current?.control.hasPointerCapture(current.pointerId)) {
      current.control.releasePointerCapture(current.pointerId);
    }
    return current;
  }, []);
  const cancel = useCallback(() => {
    const current = release();
    if (current?.changed) cancelCallback.current?.();
  }, [release]);

  useLayoutEffect(() => {
    cancel();
  }, [disabled, readOnly, interactionKey, min, max, step, orientation, direction, cancel]);
  useEffect(() => () => {
    const current = release(false);
    if (current?.changed) cancelCallback.current?.();
  }, [release]);

  function pointValue(event: { clientX: number; clientY: number }, offset: number) {
    const rect = trackRef.current!.getBoundingClientRect();
    const vertical = orientation === 'vertical';
    const size = vertical ? rect.height : rect.width;
    if (size <= 0) return value;
    const point = (vertical ? event.clientY : event.clientX) - offset;
    const distance = vertical ? rect.bottom - point
      : direction === 'rtl' ? rect.right - point : point - rect.left;
    const ratio = Math.min(1, Math.max(0, distance / size));
    const stepped = min + Math.round((ratio * (max - min)) / step) * step;
    return Math.min(max, Math.max(min,
      Number(stepped.toFixed(Math.min(100, Math.max(precision(min), precision(step))))),
    ));
  }

  function owns(event: { pointerId: number }) {
    const current = gesture.current;
    if (!current || disabled || readOnly || current.interactionKey !== interactionKey
      || current.pointerId !== event.pointerId) return null;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.left !== current.geometry.left || rect.top !== current.geometry.top
      || rect.width !== current.geometry.width || rect.height !== current.geometry.height) {
      cancel();
      return null;
    }
    return current;
  }

  function changePointer(event: { pointerId: number; clientX: number; clientY: number }) {
    const current = owns(event);
    if (!current) return;
    const next = pointValue(event, current.offset);
    if (next === current.value) return;
    current.value = next;
    current.changed = true;
    onValueChange(next);
  }

  // Control/Thumb expose public event cancellation. Owning their pointer path
  // avoids Base UI's document listener ending a drag for an unrelated pointer;
  // Base UI still owns the native range input, keyboard and accessibility.
  const controlHandlers: Pick<
    BaseSlider.Control.Props,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
      | 'onLostPointerCapture' | 'onTouchStartCapture' | 'onKeyDownCapture' | 'onBlurCapture'
  > = {
    onPointerDown(event) {
      event.preventBaseUIHandler();
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      if (disabled || readOnly) return;
      if (gesture.current && gesture.current.pointerId !== event.pointerId) return;
      focus.markPointerFocus();
      cancel();
      const vertical = orientation === 'vertical';
      const thumb = thumbRef.current;
      const rect = thumb?.getBoundingClientRect();
      const onThumb = thumb?.contains(event.target as Node);
      const geometry = trackRef.current!.getBoundingClientRect();
      const offset = onThumb && rect
        ? (vertical ? event.clientY - (rect.top + rect.height / 2)
          : event.clientX - (rect.left + rect.width / 2)) : 0;
      gesture.current = {
        pointerId: event.pointerId, control: event.currentTarget, interactionKey,
        offset, value, changed: false,
        geometry: { left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height },
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      inputRef.current?.focus({ preventScroll: true });
      setDragging(true);
      changePointer(event);
    },
    onPointerMove(event) {
      event.preventBaseUIHandler();
      if (event.buttons === 0) {
        const current = owns(event);
        if (!current) return;
        release();
        if (current?.changed) onCommit?.(current.value);
      } else changePointer(event);
    },
    onPointerUp(event) {
      event.preventBaseUIHandler();
      const current = owns(event);
      if (!current) return;
      release();
      if (current.changed) onCommit?.(current.value);
    },
    onPointerCancel(event) {
      event.preventBaseUIHandler();
      if (gesture.current?.pointerId === event.pointerId) cancel();
    },
    onLostPointerCapture(event) {
      event.preventBaseUIHandler();
      if (gesture.current?.pointerId === event.pointerId) cancel();
    },
    onTouchStartCapture(event) {
      // Modern Chromium sends Pointer Events for touch. Stop only this local
      // legacy start so Base UI cannot create a second private gesture.
      event.stopPropagation();
    },
    onKeyDownCapture: focus.onKeyDownCapture,
    onBlurCapture: focus.onBlurCapture,
  };

  const permitsDiscrete = (event: Event) => !disabled && !readOnly
    && ['keydown', 'input', 'change'].includes(event.type);
  return { controlHandlers, trackRef, thumbRef, inputRef, dragging, pointerFocus: focus.pointerFocus, cancel, permitsDiscrete };
}
