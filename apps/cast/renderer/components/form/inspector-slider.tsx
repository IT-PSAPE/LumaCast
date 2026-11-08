import type { KeyboardEvent } from 'react';
import { Slider } from '@base-ui/react/slider';
import { cn, useSliderInteraction } from '@lumacast/ui';

interface InspectorSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
  ariaLabel?: string;
}

export function InspectorSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label = 'Size',
  ariaLabel,
}: InspectorSliderProps) {
  // Base UI only clamps to [min, max] for the underlying input's native
  // change event (keyboard/drag interactions already step correctly on their
  // own); snapping to `step` here keeps every path — typed, dragged, or
  // keyboard-stepped — landing on the same snapped value.
  function handleValueChange(next: number) {
    const snapped = Math.round(next / step) * step;
    const clamped = Math.min(Math.max(snapped, min), max);
    const normalized = Number.isInteger(step)
      ? Math.round(clamped)
      : parseFloat(clamped.toFixed(countDecimals(step)));
    onChange(normalized);
  }

  // This control is designed to live inside a Dropdown menu, whose panel claims
  // ArrowUp/ArrowDown/Home/End for menu navigation and single characters for
  // type-ahead — exactly the keys a range input needs. Keep those keys for the
  // slider and leave the menu's own keys alone. Pointer interactions are owned
  // separately by the shared interaction recipe.
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') return;
    event.stopPropagation();
  }

  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const remaining = step === 0 ? 0 : Math.max(0, Math.round((max - value) / step));
  const interaction = useSliderInteraction({ value, min, max, step, onValueChange: handleValueChange });

  return (
    <Slider.Root
      className="relative flex h-8 w-full items-center overflow-hidden rounded-control bg-tertiary px-2.5"
      {...interaction.rootProps}
    >
      {/* filled portion */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 rounded-l-control bg-tertiary"
        style={{ width: `${percent}%` }}
      />
      {/* tick dots in unfilled region */}
      {remaining > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 flex items-center justify-evenly"
          style={{ left: `calc(${percent}% + 8px)`, right: '36px' }}
        >
          {Array.from({ length: remaining }).map((_, index) => (
            <span
              key={index}
              className="h-1 w-1 shrink-0 rounded-full bg-(--border-color-primary)"
            />
          ))}
        </div>
      )}
      {/* Thumb visual. Travel is inset by the thumb's own width so it stays inside
          the pill's end caps instead of clipping at 0% and 100%. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-(--text-color-secondary)"
        style={{ left: `calc(${percent / 100} * (100% - 6px) + 1px)` }}
      />
      {/* label left */}
      <span className="pointer-events-none relative text-xs font-medium text-secondary">
        {label}
      </span>
      {/* value right */}
      <span className="pointer-events-none relative ml-auto text-xs tabular-nums text-secondary">
        {value}
      </span>
      {/* Interactive layer: covers the whole pill so click-anywhere-to-seek and
          drag keep working, exactly like the invisible full-size range input
          before it. The thumb itself stays visually hidden — the dressing
          above already draws the fill, ticks and thumb line. */}
      <Slider.Control ref={interaction.measurementRef} className={cn('absolute inset-0 h-full w-full cursor-pointer rounded-control', interaction.focusClassName)} {...interaction.controlProps}>
        <Slider.Thumb aria-label={ariaLabel ?? label} onKeyDown={handleKeyDown} className="outline-none" {...interaction.thumbProps} />
      </Slider.Control>
    </Slider.Root>
  );
}

function countDecimals(value: number): number {
  const text = String(value);
  const dotIndex = text.indexOf('.');
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}
