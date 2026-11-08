import { useRef } from 'react';
import { Slider as BaseSlider } from '@base-ui/react/slider';
import { cn } from './cn';
import { cv } from './cv';
import { Field, useFieldIds, type FieldLabelPlacement } from './field';
import { sliderThumbFocusStyles } from './use-slider-focus';
import { normalizeRangeEdge, useRangeSliderPointer } from './use-range-slider-pointer';

export type RangeValue = readonly [start: number, end: number];

export interface RangeSliderProps {
  /** `[in, out]`. */
  value: RangeValue;
  /** Fires continuously while dragging or stepping. */
  onValueChange: (value: [number, number]) => void;
  /** Fires once on pointer release or keyboard settle. */
  onCommit?: (value: [number, number]) => void;
  /** A pointer edit was interrupted; discard its uncommitted preview. */
  onCancel?: () => void;
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
  base: 'block rounded-full bg-primary outline-none ring-1 ring-brand/60 data-dragging:ring-2 data-disabled:ring-0',
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
  onCancel,
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
  const span = max - min || 1;
  const gap = Math.max(minRange ?? step, 0);
  const toPercent = (v: number) => Math.min(100, Math.max(0, ((v - min) / span) * 100));
  const [start, end] = value;
  const left = toPercent(start);
  const right = toPercent(end);

  const pointer = useRangeSliderPointer({ value, min, max, step, gap, disabled, draggableRange, onValueChange, onCommit, onCancel, onSeek });
  const settled = useRef<[number, number] | null>(null);
  const normalize = (next: readonly number[], activeIndex?: number): [number, number] | null => {
    const index = activeIndex === 0 || activeIndex === 1 ? activeIndex : next[0] !== start ? 0 : 1;
    return normalizeRangeEdge(next[index]!, value, index, min, max, step, gap);
  };

  const thumbProps = (index: 0 | 1, name: string) => ({
    index,
    ref: pointer.thumbs[index],
    inputRef: pointer.inputs[index],
    onPointerDown: (event: Parameters<NonNullable<BaseSlider.Thumb.Props['onPointerDown']>>[0]) => event.preventBaseUIHandler(),
    'data-dragging': pointer.draggingThumb === index ? '' : undefined,
    'aria-label': name,
    'aria-describedby': ids.describedBy,
    getAriaValueText: formatValue ? (_formatted: string, v: number) => formatValue(v) : undefined,
    className: cn(thumbStyles({ size }), !pointer.pointerFocus && sliderThumbFocusStyles),
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
        onValueChange={(next, details) => {
          if (!pointer.permitsDiscrete(details.event)) { details.cancel(); return; }
          pointer.cancel();
          const normalized = normalize(Array.isArray(next) ? next : [next, next], details.activeThumbIndex);
          if (!normalized) { details.cancel(); return; }
          settled.current = normalized;
          onValueChange(normalized);
        }}
        onValueCommitted={onCommit ? (next, details) => {
          if (!pointer.permitsDiscrete(details.event)) return;
          const normalized = settled.current ?? normalize(Array.isArray(next) ? next : [next, next]);
          settled.current = null;
          if (normalized) onCommit(normalized);
        } : undefined}
        className="min-w-0 flex-1 data-disabled:opacity-50"
      >
        <BaseSlider.Control
          {...pointer.controlHandlers}
          className="flex h-6 w-full touch-none items-center justify-center data-disabled:cursor-not-allowed"
        >
          <BaseSlider.Track ref={pointer.trackRef} className={trackStyles({ size })}>
            <div className={fillStyles({ tone })} style={{ left: `${pointer.direction === 'rtl' ? 100 - right : left}%`, width: `${Math.max(0, right - left)}%` }} />
            {onSeek ? <div data-seek="" className="absolute -inset-y-2 inset-x-0 cursor-pointer" /> : null}
            {draggableRange ? (
              <div
                data-range-drag=""
                className={cn('absolute -inset-y-2', disabled ? '' : 'cursor-grab active:cursor-grabbing')}
                style={{ left: `${pointer.direction === 'rtl' ? 100 - right : left}%`, width: `${Math.max(0, right - left)}%` }}
              />
            ) : null}
            {playhead !== undefined ? (
              <div data-playhead="" aria-hidden="true" className={playheadStyles({ size })} style={{ left: `${pointer.direction === 'rtl' ? 100 - toPercent(playhead) : toPercent(playhead)}%` }} />
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
