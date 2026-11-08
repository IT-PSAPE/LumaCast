import type { Slider as BaseSlider } from '@base-ui/react/slider';
import { useDirection } from '@base-ui/react/direction-provider';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RangeValue } from './range-slider';
import { useSliderFocus } from './use-slider-focus';

type Options = {
  value: RangeValue;
  min: number; max: number; step: number; gap: number;
  disabled?: boolean;
  draggableRange: boolean;
  onValueChange: (value: [number, number]) => void;
  onCommit?: (value: [number, number]) => void;
  onCancel?: () => void;
  onSeek?: (value: number) => void;
};
type Geometry = { left: number; top: number; width: number; height: number };
type Gesture = {
  pointerId: number;
  control: HTMLDivElement;
  kind: 'seek' | 'range' | 'thumb';
  index: 0 | 1;
  offset: number;
  originX: number;
  origin: [number, number];
  latest: [number, number];
  geometry: Geometry;
  thumbSize?: { width: number; height: number };
  constraints: { min: number; max: number; step: number; gap: number; draggableRange: boolean; seek: boolean; direction: string };
  moved: boolean;
  previewed: boolean;
};

function precision(value: number) {
  const [mantissa, exponent = '0'] = String(value).split('e');
  return Math.max(0, (mantissa.split('.')[1]?.length ?? 0) - Number(exponent));
}

// Preserve off-grid stationary duration endpoints. Only the moving edge snaps
// to a feasible min-origin grid point, respecting non-step-multiple gaps.
export function normalizeRangeEdge(candidate: number, value: RangeValue, index: 0 | 1, min: number, max: number, step: number, gap: number): [number, number] | null {
  if (![candidate, ...value, min, max, step, gap].every(Number.isFinite) || max <= min || step <= 0 || gap < 0
    || value[0] < min || value[1] > max || value[0] > value[1]) return null;
  const last = Math.floor((max - min) / step + 1e-9);
  const low = index === 0 ? 0 : Math.max(0, Math.ceil((value[0] + gap - min) / step - 1e-9));
  const high = index === 1 ? last : Math.min(last, Math.floor((value[1] - gap - min) / step + 1e-9));
  if (low > high) return null;
  const grid = Math.min(high, Math.max(low, Math.round((candidate - min) / step)));
  const point = Number((min + grid * step).toFixed(Math.min(100, Math.max(precision(min), precision(step)))));
  return index === 0 ? [point, value[1]] : [value[0], point];
}

// A single public owner prevents Base UI's unfiltered document end listener
// from creating a second writer. Base UI retains inputs, keyboard and rendering.
export function useRangeSliderPointer(options: Options) {
  const direction = useDirection();
  const trackRef = useRef<HTMLDivElement>(null);
  const startThumb = useRef<HTMLDivElement>(null);
  const endThumb = useRef<HTMLDivElement>(null);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const thumbs = [startThumb, endThumb] as const;
  const inputs = [startInput, endInput] as const;
  const owner = useRef<Gesture | null>(null);
  const latest = useRef({ ...options, direction });
  useLayoutEffect(() => { latest.current = { ...options, direction }; });
  const [draggingThumb, setDraggingThumb] = useState<0 | 1 | null>(null);
  const focus = useSliderFocus();

  const release = useCallback((updateState = true) => {
    const current = owner.current;
    owner.current = null;
    if (updateState) setDraggingThumb(null);
    // Releasing capture can synchronously dispatch lostpointercapture.
    if (current?.control.hasPointerCapture?.(current.pointerId)) current.control.releasePointerCapture(current.pointerId);
    return current;
  }, []);
  const cancel = useCallback(() => {
    const current = release();
    if (current?.previewed) latest.current.onCancel?.();
  }, [release]);

  function validGeometry(current: Gesture) {
    const box = trackRef.current?.getBoundingClientRect();
    const thumb = current.kind === 'thumb' ? thumbs[current.index].current?.getBoundingClientRect() : null;
    return box && box.left === current.geometry.left && box.top === current.geometry.top
      && box.width === current.geometry.width && box.height === current.geometry.height
      && (!current.thumbSize || (thumb?.width === current.thumbSize.width && thumb.height === current.thumbSize.height));
  }
  function matching(pointerId: number) {
    const current = owner.current;
    if (!current || current.pointerId !== pointerId) return null;
    const now = latest.current;
    const before = current.constraints;
    if (now.disabled || now.min !== before.min || now.max !== before.max || now.step !== before.step || now.gap !== before.gap
      || now.draggableRange !== before.draggableRange || Boolean(now.onSeek) !== before.seek || now.direction !== before.direction || !validGeometry(current)) {
      cancel(); return null;
    }
    return current;
  }

  useLayoutEffect(() => { cancel(); }, [options.disabled, options.min, options.max, options.step, options.gap, options.draggableRange, Boolean(options.onSeek), direction, cancel]);
  useLayoutEffect(() => { if (owner.current && !validGeometry(owner.current)) cancel(); });
  useEffect(() => () => {
    const current = release(false);
    if (current?.previewed) latest.current.onCancel?.();
  }, [release]);

  function pointValue(current: Gesture, clientX: number) {
    const { min, max, direction: originDirection } = current.constraints;
    const physical = clientX - current.offset - current.geometry.left;
    const ratio = originDirection === 'rtl' ? 1 - physical / current.geometry.width : physical / current.geometry.width;
    return min + Math.min(1, Math.max(0, ratio)) * (max - min);
  }
  function finish(current: Gesture) {
    release();
    if (current.previewed) latest.current.onCommit?.([...current.latest]);
    else if (current.kind === 'range' && !current.moved) {
      latest.current.onSeek?.(Math.min(current.origin[1], Math.max(current.origin[0], pointValue(current, current.originX))));
    }
  }
  function place(current: Gesture, clientX: number) {
    const { min, max, step, gap, direction: originDirection } = current.constraints;
    if (current.kind === 'seek') { latest.current.onSeek?.(pointValue(current, clientX)); return; }
    let next: [number, number] | null;
    if (current.kind === 'thumb') next = normalizeRangeEdge(pointValue(current, clientX), current.origin, current.index, min, max, step, gap);
    else {
      if (!current.moved && Math.abs(clientX - current.originX) < 3) return;
      current.moved = true;
      const length = current.origin[1] - current.origin[0];
      const raw = current.origin[0] + (originDirection === 'rtl' ? -1 : 1) * ((clientX - current.originX) / current.geometry.width) * (max - min);
      const snapped = Number((min + Math.round((raw - min) / step) * step).toFixed(Math.min(100, Math.max(precision(min), precision(step)))));
      const digits = Math.min(100, Math.max(precision(min), precision(max), precision(step), ...current.origin.map(precision)));
      const from = Number(Math.min(max - length, Math.max(min, snapped)).toFixed(digits));
      next = [from, Number((from + length).toFixed(digits))];
    }
    if (!next || (current.latest[0] === next[0] && current.latest[1] === next[1])) return;
    current.latest = next;
    current.previewed = true;
    latest.current.onValueChange([...next]);
  }

  const controlHandlers: Pick<BaseSlider.Control.Props, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onTouchStartCapture' | 'onKeyDownCapture' | 'onBlurCapture'> = {
    onPointerDown(event) {
      event.preventBaseUIHandler();
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      const now = latest.current;
      if (now.disabled || (owner.current && owner.current.pointerId !== event.pointerId)) return;
      cancel();
      const box = trackRef.current?.getBoundingClientRect();
      if (!box || box.width <= 0 || ![box.left, box.top, box.width, box.height, now.min, now.max, now.step, now.gap, ...now.value].every(Number.isFinite)
        || now.max <= now.min || now.step <= 0 || now.gap < 0 || now.value[0] < now.min || now.value[1] > now.max || now.value[1] - now.value[0] < now.gap - 1e-9) return;
      const target = event.target;
      let index: 0 | 1 = 0;
      const direct = thumbs.findIndex((ref) => target instanceof Node && ref.current?.contains(target));
      let kind: Gesture['kind'] = 'thumb';
      if (direct >= 0) index = direct as 0 | 1;
      else if (target instanceof Element && target.closest('[data-range-drag]')) kind = 'range';
      else if (target instanceof Element && target.closest('[data-seek]')) kind = 'seek';
      else {
        let closest = Infinity;
        for (const candidate of [0, 1] as const) {
          const thumbBox = thumbs[candidate].current?.getBoundingClientRect();
          if (!thumbBox || ![thumbBox.left, thumbBox.top, thumbBox.width, thumbBox.height].every(Number.isFinite) || thumbBox.width <= 0 || thumbBox.height <= 0) continue;
          const distance = Math.abs(event.clientX - (thumbBox.left + thumbBox.width / 2));
          if (distance <= closest) { closest = distance; index = candidate; }
        }
        if (!Number.isFinite(closest)) return;
      }
      if ((kind === 'range' && !now.draggableRange) || (kind === 'seek' && !now.onSeek)) return;
      if (kind === 'thumb' && direct >= 0 && now.value[0] === now.max && now.value[1] === now.max) index = 0;
      const thumbBox = kind === 'thumb' ? thumbs[index].current?.getBoundingClientRect() : null;
      if (kind === 'thumb' && (!thumbBox || ![thumbBox.left, thumbBox.top, thumbBox.width, thumbBox.height].every(Number.isFinite) || thumbBox.width <= 0 || thumbBox.height <= 0)) return;
      const current: Gesture = {
        pointerId: event.pointerId, control: event.currentTarget, kind, index,
        offset: direct >= 0 && thumbBox ? event.clientX - (thumbBox.left + thumbBox.width / 2) : 0,
        originX: event.clientX, origin: [now.value[0], now.value[1]], latest: [now.value[0], now.value[1]],
        geometry: { left: box.left, top: box.top, width: box.width, height: box.height },
        thumbSize: thumbBox ? { width: thumbBox.width, height: thumbBox.height } : undefined,
        constraints: { min: now.min, max: now.max, step: now.step, gap: now.gap, draggableRange: now.draggableRange, seek: Boolean(now.onSeek), direction: now.direction },
        moved: false, previewed: false,
      };
      owner.current = current;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      if (kind === 'thumb') {
        focus.markPointerFocus();
        inputs[index].current?.focus({ preventScroll: true });
        setDraggingThumb(index);
        if (direct < 0) place(current, event.clientX);
      } else if (kind === 'seek') place(current, event.clientX);
    },
    onPointerMove(event) {
      event.preventBaseUIHandler();
      const current = matching(event.pointerId);
      if (!current) return;
      if (event.buttons === 0) finish(current);
      else place(current, event.clientX);
    },
    onPointerUp(event) {
      event.preventBaseUIHandler();
      const current = matching(event.pointerId);
      if (current) finish(current);
    },
    onPointerCancel(event) {
      event.preventBaseUIHandler();
      if (owner.current?.pointerId === event.pointerId) cancel();
    },
    onLostPointerCapture(event) {
      event.preventBaseUIHandler();
      if (owner.current?.pointerId === event.pointerId) cancel();
    },
    onTouchStartCapture(event) { event.stopPropagation(); },
    onKeyDownCapture(event) {
      focus.onKeyDownCapture(event);
      if (!['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) cancel();
    },
    onBlurCapture: focus.onBlurCapture,
  };

  return {
    trackRef, thumbs, inputs, direction, pointerFocus: focus.pointerFocus, draggingThumb, controlHandlers, cancel,
    permitsDiscrete: (event: { type: string }) => !options.disabled && ['keydown', 'input', 'change'].includes(event.type),
  };
}
