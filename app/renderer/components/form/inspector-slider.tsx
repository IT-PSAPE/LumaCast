import type { ChangeEvent } from 'react';

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
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = Number(event.target.value);
    const snapped = Math.round(raw / step) * step;
    const clamped = Math.min(Math.max(snapped, min), max);
    const rounded = Number.isInteger(step)
      ? Math.round(clamped)
      : parseFloat(clamped.toFixed(countDecimals(step)));
    onChange(rounded);
  }

  // This control is designed to live inside a Dropdown menu, whose panel claims
  // ArrowUp/ArrowDown/Home/End for menu navigation and single characters for
  // type-ahead — exactly the keys a range input needs. Keep those keys for the
  // slider and leave the menu's own keys alone. Note this must never
  // preventDefault() on pointerdown: that suppresses the compatibility mouse
  // events the native range thumb relies on, which kills drag and click-to-seek.
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' || event.key === 'Tab') return;
    event.stopPropagation();
  }

  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const remaining = step === 0 ? 0 : Math.max(0, Math.round((max - value) / step));

  return (
    <div className="relative flex h-8 w-full items-center overflow-hidden rounded-lg bg-tertiary px-2.5 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-brand">
      {/* filled portion */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-quaternary"
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
              className="h-1 w-1 shrink-0 rounded-full bg-border-primary"
            />
          ))}
        </div>
      )}
      {/* Thumb. Travel is inset by the thumb's own width so it stays inside
          the pill's rounded ends instead of clipping at 0% and 100%. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-text-secondary"
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
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel ?? label}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
      />
    </div>
  );
}

function countDecimals(value: number): number {
  const text = String(value);
  const dotIndex = text.indexOf('.');
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}
