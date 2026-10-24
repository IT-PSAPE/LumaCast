import { Slider as BaseSlider } from '@base-ui/react/slider';
import { cn } from './cn';
import { cv } from './cv';
import { Field, useFieldIds, type FieldLabelPlacement } from './field';

export interface SliderProps {
  value: number;
  /** Fires continuously while dragging or stepping. */
  onValueChange: (value: number) => void;
  /** Fires once on pointer release or keyboard settle. */
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  orientation?: 'horizontal' | 'vertical';
  size?: 'sm' | 'md';
  /** Fill colour of the active track. */
  tone?: 'brand' | 'neutral';
  showValue?: boolean;
  formatValue?: (value: number) => string;
  /** Origin the fill grows from; defaults to `min`. Use 0 for bipolar controls such as pan. */
  fillFrom?: number;
  disabled?: boolean;
  label?: string;
  labelPlacement?: FieldLabelPlacement;
  id?: string;
  className?: string;
}

const trackStyles = cv({
  base: 'relative rounded-full bg-tertiary',
  variants: {
    orientation: { horizontal: 'w-full', vertical: 'h-full' },
    size: { sm: '', md: '' },
  },
  compoundVariants: [
    { orientation: 'horizontal', size: 'sm', class: 'h-0.5' },
    { orientation: 'horizontal', size: 'md', class: 'h-1' },
    { orientation: 'vertical', size: 'sm', class: 'w-0.5' },
    { orientation: 'vertical', size: 'md', class: 'w-1' },
  ],
});

const thumbStyles = cv({
  base: 'block rounded-full bg-primary outline-none ring-1 ring-brand/60 focus-visible:ring-2 focus-visible:ring-brand data-dragging:ring-2 data-disabled:ring-0',
  variants: {
    size: { sm: 'size-2.5', md: 'size-3.5' },
  },
});

const fillStyles = cv({
  base: 'absolute rounded-full',
  variants: {
    tone: { brand: 'bg-brand', neutral: 'bg-secondary' },
  },
});

export function Slider({
  value,
  onValueChange,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  orientation = 'horizontal',
  size = 'md',
  tone = 'brand',
  showValue,
  formatValue,
  fillFrom,
  disabled,
  label,
  labelPlacement,
  id,
  className,
}: SliderProps) {
  const ids = useFieldIds(id);
  const vertical = orientation === 'vertical';
  const range = max - min || 1;
  const toPercent = (v: number) => Math.min(100, Math.max(0, ((v - min) / range) * 100));
  const from = toPercent(fillFrom ?? min);
  const to = toPercent(value);
  const start = Math.min(from, to);
  const length = Math.abs(to - from);
  const fillPosition = vertical
    ? { bottom: `${start}%`, height: `${length}%`, left: 0, right: 0 }
    : { left: `${start}%`, width: `${length}%`, top: 0, bottom: 0 };

  const control = (
    <div className={cn('flex items-center gap-2', vertical ? 'h-full flex-col' : 'w-full', className)}>
      <BaseSlider.Root
        value={value}
        min={min}
        max={max}
        step={step}
        largeStep={Math.max(step, (max - min) / 10)}
        orientation={orientation}
        disabled={disabled}
        onValueChange={(next) => onValueChange(Array.isArray(next) ? next[0]! : next)}
        onValueCommitted={onCommit ? (next) => onCommit(Array.isArray(next) ? next[0]! : next) : undefined}
        className={cn('data-disabled:opacity-50', vertical ? 'h-full min-h-0 flex-1' : 'min-w-0 flex-1')}
      >
        <BaseSlider.Control
          className={cn(
            'flex touch-none items-center justify-center data-disabled:cursor-not-allowed',
            vertical ? 'h-full min-h-12 w-5' : 'h-5 w-full',
          )}
        >
          <BaseSlider.Track className={trackStyles({ orientation, size })}>
            <div className={fillStyles({ tone })} style={fillPosition} />
            <BaseSlider.Thumb
              id={ids.id}
              aria-label={label}
              aria-describedby={ids.describedBy}
              className={thumbStyles({ size })}
            />
          </BaseSlider.Track>
        </BaseSlider.Control>
      </BaseSlider.Root>
      {showValue ? (
        <output
          htmlFor={ids.id}
          className="min-w-10 shrink-0 text-right text-sm tabular-nums text-secondary"
        >
          {formatValue ? formatValue(value) : value}
        </output>
      ) : null}
    </div>
  );

  return (
    <Field label={label} labelPlacement={labelPlacement} disabled={disabled} htmlFor={ids.id}>
      {control}
    </Field>
  );
}
