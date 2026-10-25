import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { cn } from './cn';
import { cv } from './cv';
import { Field, useFieldIds, type FieldLabelPlacement } from './field';

export type RangeValue = readonly [start: number, end: number];

export interface RangeSliderProps {
  /** `[in, out]`. */
  value: RangeValue;
  /** Fires continuously while dragging or stepping. */
  onValueChange: (value: [number, number]) => void;
  /** Fires once on pointer release or keyboard settle. */
  onCommit?: (value: [number, number]) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Smallest allowed distance between the handles, in value units. Defaults to one `step`. */
  minRange?: number;
  /** Optional position marker. Decorative: it reports, it is not a control. */
  playhead?: number;
  size?: 'sm' | 'md';
  /** Fill colour of the selected region. */
  tone?: 'brand' | 'neutral';
  /**
   * Makes the track itself a scrub surface: pressing or dragging on it reports a position here.
   * The handles keep their own gesture; inside the filled region a drag still moves the range and
   * only a click seeks. The playhead stays decorative;
   * keyboard seeking belongs to whatever transport owns the position.
   */
  onSeek?: (value: number) => void;
  /** Whether dragging the filled region moves the whole range. Defaults to true. */
  draggableRange?: boolean;
  disabled?: boolean;
  label?: string;
  labelPlacement?: FieldLabelPlacement;
  /** Full accessible names of the two handles (include what is being trimmed); default to `In`/`Out`. */
  startLabel?: string;
  endLabel?: string;
  /** Spoken form of a handle value (`aria-valuetext`). */
  formatValue?: (value: number) => string;
  id?: string;
  className?: string;
}

const trackStyles = cv({
  base: 'relative w-full rounded-full bg-tertiary',
  variants: { size: { sm: 'h-1', md: 'h-1.5' } },
});

const thumbStyles = cv({
  base: 'block rounded-full bg-primary outline-none ring-1 ring-brand/60 focus-visible:ring-2 focus-visible:ring-brand data-dragging:ring-2 data-disabled:ring-0',
  variants: { size: { sm: 'size-3', md: 'size-4' } },
});

const fillStyles = cv({
  base: 'absolute inset-y-0 rounded-full',
  variants: { tone: { brand: 'bg-brand', neutral: 'bg-secondary' } },
});

const playheadStyles = cv({
  base: 'pointer-events-none absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current text-primary',
  variants: { size: { sm: 'h-4', md: 'h-5' } },
});

export function RangeSlider({
  value,
  onValueChange,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  minRange,
  playhead,
  size = 'md',
  tone = 'brand',
  onSeek,
  draggableRange = true,
  disabled,
  label,
  labelPlacement,
  startLabel = 'In',
  endLabel = 'Out',
  formatValue,
  id,
  className,
}: RangeSliderProps) {
  const ids = useFieldIds(id);
  const trackRef = useRef<HTMLDivElement>(null);
  const span = max - min || 1;
  const gap = Math.max(minRange ?? step, 0);
  const toPercent = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));
  const [start, end] = value;
  const left = toPercent(start);
  const right = toPercent(end);

  const dragRange = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (disabled || !draggableRange || !track || event.button !== 0) return;
    const box = track.getBoundingClientRect();
    const width = box.width;
    if (width <= 0) return;
    // Base UI would otherwise start a thumb drag from the control's pointerdown.
    event.stopPropagation();
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const originX = event.clientX;
    const length = end - start;
    const origin = start;
    let latest: [number, number] = [start, end];
    let moved = false;
    const place = (clientX: number) => {
      if (Math.abs(clientX - originX) < 3 && !moved) return;
      moved = true;
      const raw = origin + ((clientX - originX) / width) * span;
      const snapped = Math.round((raw - min) / step) * step + min;
      const from = Math.min(max - length, Math.max(min, snapped));
      latest = [from, from + length];
      onValueChange(latest);
    };
    const onMove = (move: PointerEvent) => place(move.clientX);
    const finish = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', finish);
      // A press that never became a drag is a click on the track: seek there.
      if (!moved) onSeek?.(Math.min(end, Math.max(start, min + ((originX - box.left) / width) * span)));
      else onCommit?.(latest);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
  };

  const seek = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (disabled || !onSeek || !track || event.button !== 0) return;
    const box = track.getBoundingClientRect();
    if (box.width <= 0) return;
    event.stopPropagation();
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);
    const place = (clientX: number) => onSeek(Math.min(max, Math.max(min, min + ((clientX - box.left) / box.width) * span)));
    const onMove = (move: PointerEvent) => place(move.clientX);
    const finish = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', finish);
      target.removeEventListener('pointercancel', finish);
    };
    place(event.clientX);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', finish);
    target.addEventListener('pointercancel', finish);
  };

  // Base UI measures the minimum distance with raw float arithmetic (5 - 4.9 < 0.1 for a 0.01
  // step), so it is given no minimum and the exact gap is enforced here.
  const settled = useRef<[number, number] | null>(null);
  const clean = (v: number) => Math.min(max, Math.max(min, Number((Math.round((v - min) / step) * step + min).toFixed(10))));
  const normalize = (next: readonly number[]): [number, number] => {
    let a = clean(next[0]!);
    let b = clean(next[1]!);
    if (b - a < gap - 1e-9) {
      if (a !== start) a = clean(Math.min(b - gap, a));
      else b = clean(Math.max(a + gap, b));
      if (b - a < gap - 1e-9) { if (a !== start) a = clean(b - gap); else b = clean(a + gap); }
    }
    return [a, b];
  };

  const thumbProps = (index: 0 | 1, name: string) => ({
    index,
    'aria-label': name,
    'aria-describedby': ids.describedBy,
    getAriaValueText: formatValue ? (_formatted: string, v: number) => formatValue(v) : undefined,
    className: thumbStyles({ size }),
  });

  const control = (
    <div className={cn('flex w-full items-center gap-2', className)}>
      <BaseSlider.Root
        value={[start, end]}
        min={min}
        max={max}
        step={step}
        largeStep={Math.max(step, (max - min) / 10)}
        minStepsBetweenValues={0}
        thumbCollisionBehavior="none"
        disabled={disabled}
        onValueChange={(next) => {
          const normalized = normalize(Array.isArray(next) ? next : [next, next]);
          settled.current = normalized;
          onValueChange(normalized);
        }}
        onValueCommitted={onCommit ? (next) => {
          const normalized = settled.current ?? normalize(Array.isArray(next) ? next : [next, next]);
          settled.current = null;
          onCommit(normalized);
        } : undefined}
        className="min-w-0 flex-1 data-disabled:opacity-50"
      >
        <BaseSlider.Control className="flex h-6 w-full touch-none items-center justify-center data-disabled:cursor-not-allowed">
          <BaseSlider.Track ref={trackRef} className={trackStyles({ size })}>
            <div className={fillStyles({ tone })} style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }} />
            {onSeek ? <div data-seek="" className="absolute -inset-y-2 inset-x-0 cursor-pointer" onPointerDown={seek} /> : null}
            {draggableRange ? (
              <div
                data-range-drag=""
                className={cn('absolute -inset-y-2', disabled ? '' : 'cursor-grab active:cursor-grabbing')}
                style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
                onPointerDown={dragRange}
              />
            ) : null}
            {playhead !== undefined ? (
              <div data-playhead="" aria-hidden="true" className={playheadStyles({ size })} style={{ left: `${toPercent(playhead)}%` }} />
            ) : null}
            <BaseSlider.Thumb id={ids.id} {...thumbProps(0, startLabel)} />
            <BaseSlider.Thumb {...thumbProps(1, endLabel)} />
          </BaseSlider.Track>
        </BaseSlider.Control>
      </BaseSlider.Root>
    </div>
  );

  return (
    <Field label={label} labelPlacement={labelPlacement} disabled={disabled} htmlFor={ids.id}>
      {control}
    </Field>
  );
}
