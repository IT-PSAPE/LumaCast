import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cv } from './cv';
import { Field, useFieldIds, type FieldLabelPlacement } from './field';

// Same box metrics and focus treatment as `TextField`/`Select` (md: px-3 py-1.5).
// `label-xs` carries a 1.1 line-height that is too tight for multiple lines,
// so it is overridden here; autoResize reads the computed value back.
const textareaVariants = cv({
  base: 'block w-full min-w-0 rounded-sm bg-tertiary px-3 py-1.5 text-primary label-xs leading-[1.4]! transition-colors placeholder:text-tertiary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
  variants: {
    invalid: {
      true: 'ring-1 ring-error',
      false: 'hover:bg-brand/10 focus:ring-1 focus:ring-brand',
    },
    resize: {
      true: 'resize-none overflow-y-hidden',
      false: 'resize-y',
    },
  },
  defaultVariants: { invalid: false, resize: false },
});

export interface TextareaProps {
  value: string;
  onValueChange: (value: string) => void;
  /** `change` fires every keystroke; `blur` keeps a draft and fires on blur only (Enter is a newline). */
  commitOn?: 'blur' | 'change';
  rows?: number;
  /** Grow with content; scrolls once `maxRows` is reached. */
  autoResize?: boolean;
  maxRows?: number;
  placeholder?: string;
  label?: string;
  labelPlacement?: FieldLabelPlacement;
  error?: string;
  hint?: string;
  disabled?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  id?: string;
  className?: string;
}

export function Textarea({
  value,
  onValueChange,
  commitOn = 'change',
  rows = 3,
  autoResize = false,
  maxRows,
  placeholder,
  label,
  labelPlacement,
  error,
  hint,
  disabled,
  readOnly,
  maxLength,
  id,
  className,
}: TextareaProps) {
  const ids = useFieldIds(id, { error, hint });
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const reverting = useRef(false);
  const element = useRef<HTMLTextAreaElement>(null);
  const deferred = commitOn === 'blur';
  const shown = deferred ? draft : value;

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  // Collapse to `rows`, then expand to scrollHeight, capped at `maxRows`.
  useLayoutEffect(() => {
    const node = element.current;
    if (!autoResize || !node) return;
    node.style.height = 'auto';
    const style = getComputedStyle(node);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const max = maxRows !== undefined ? maxRows * lineHeight + chrome : Infinity;
    node.style.height = `${Math.min(node.scrollHeight, max)}px`;
    node.style.overflowY = node.scrollHeight > max ? 'auto' : 'hidden';
  }, [autoResize, maxRows, rows, shown]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (deferred && event.key === 'Escape') {
      reverting.current = true;
      setDraft(value);
      event.currentTarget.blur();
    }
  }

  return (
    <Field
      label={label}
      labelPlacement={labelPlacement}
      htmlFor={ids.id}
      error={error}
      hint={hint}
      disabled={disabled}
      className={className}
    >
      <textarea
        ref={element}
        id={ids.id}
        rows={rows}
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        maxLength={maxLength}
        aria-label={labelPlacement === 'hidden' ? label : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className={textareaVariants({ invalid: Boolean(error), resize: autoResize })}
        onChange={(event) => {
          if (deferred) setDraft(event.target.value);
          else onValueChange(event.target.value);
        }}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          if (!deferred) return;
          if (reverting.current) {
            reverting.current = false;
            return;
          }
          if (draft !== value) onValueChange(draft);
        }}
        onKeyDown={handleKeyDown}
      />
    </Field>
  );
}
