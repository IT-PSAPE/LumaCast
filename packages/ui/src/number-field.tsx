import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';
import { cv } from './cv';
import { Field, useFieldIds, type FieldLabelPlacement } from './field';

// Built on a plain text input rather than Base UI's NumberField: Base UI fires
// `onValueChange` on every keystroke and clamps while typing, which cannot
// express commit-on-blur. A text input with `inputMode="decimal"` also avoids
// native number-input quirks (scroll-wheel edits, locale, 'e' characters).

// Box metrics match Select's trigger: sm = px-2 py-1, md = px-3 py-1.5, label-xs.
const boxVariants = cv({
  base: 'flex min-w-0 items-center gap-1.5 rounded-sm bg-tertiary text-primary label-xs transition-colors focus-within:ring-1 focus-within:ring-brand',
  variants: {
    size: {
      sm: 'px-2 py-1',
      md: 'px-3 py-1.5',
    },
  },
  defaultVariants: { size: 'md' },
});

function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

function format(value: number, precision?: number): string {
  if (!Number.isFinite(value)) return '';
  if (precision !== undefined) return value.toFixed(precision);
  return String(Math.round(value * 1e6) / 1e6);
}

function parse(draft: string): number | undefined {
  if (draft.trim() === '') return undefined;
  const parsed = Number(draft);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface NumberFieldProps {
  value: number;
  onValueChange: (value: number) => void;
  /** `blur` (default): commit on blur/Enter. `change`: commit on every valid keystroke. */
  commitOn?: 'blur' | 'change';
  min?: number;
  max?: number;
  step?: number;
  /** Step used with Shift+Arrow. Defaults to `step * 10`. */
  largeStep?: number;
  /** Decimal places to display. */
  precision?: number;
  /** Unit shown inside the field, e.g. `px`, `kb/s`. */
  suffix?: string;
  icon?: ReactNode;
  size?: 'sm' | 'md';
  label?: string;
  labelPlacement?: FieldLabelPlacement;
  error?: string;
  hint?: string;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  className?: string;
  placeholder?: string;
}

export function NumberField({
  value,
  onValueChange,
  commitOn = 'blur',
  min,
  max,
  step = 1,
  largeStep,
  precision,
  suffix,
  icon,
  size = 'md',
  label,
  labelPlacement,
  error,
  hint,
  disabled,
  readOnly,
  id,
  className,
  placeholder,
}: NumberFieldProps) {
  const ids = useFieldIds(id, { error, hint });
  const [draft, setDraft] = useState(() => format(value, precision));
  const focused = useRef(false);
  const skipBlurCommit = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(format(value, precision));
  }, [value, precision]);

  function commit(next: number) {
    const clamped = clamp(next, min, max);
    setDraft(format(clamped, precision));
    if (clamped !== value) onValueChange(clamped);
  }

  function handleChange(text: string) {
    setDraft(text);
    if (commitOn !== 'change') return;
    const parsed = parse(text);
    if (parsed === undefined) return;
    const clamped = clamp(parsed, min, max);
    if (clamped !== value) onValueChange(clamped);
  }

  function handleBlur() {
    focused.current = false;
    if (skipBlurCommit.current) {
      skipBlurCommit.current = false;
      setDraft(format(value, precision));
      return;
    }
    const parsed = parse(draft);
    if (parsed === undefined) setDraft(format(value, precision));
    else commit(parsed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (readOnly) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      skipBlurCommit.current = true;
      setDraft(format(value, precision));
      event.currentTarget.blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = parse(draft) ?? value;
      const amount = event.shiftKey ? (largeStep ?? step * 10) : step;
      commit(base + (event.key === 'ArrowUp' ? amount : -amount));
    }
  }

  return (
    <Field label={label} labelPlacement={labelPlacement} htmlFor={ids.id} error={error} hint={hint} disabled={disabled}>
      <div className={cn(boxVariants({ size }), disabled && 'opacity-50', error && 'ring-1 ring-error', className)}>
        {icon ? <span className="flex shrink-0 items-center text-tertiary">{icon}</span> : null}
        <input
          id={ids.id}
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="label-xs w-full min-w-0 flex-1 bg-transparent text-primary outline-none disabled:cursor-not-allowed"
        />
        {suffix ? <span className="pointer-events-none shrink-0 select-none text-right text-tertiary">{suffix}</span> : null}
      </div>
    </Field>
  );
}
