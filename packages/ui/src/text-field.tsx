import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { cv } from './cv';
import { Field, useFieldIds, type FieldLabelPlacement } from './field';

// Box metrics and focus treatment mirror `Select`'s trigger literally (sm: px-2
// py-1, md: px-3 py-1.5, label-xs, rounded-sm, bg-tertiary, 1px brand focus
// ring) so a text field and a select line up in a form row. Horizontal padding
// sits on the box and vertical padding on the input, so icon/trailing slots
// share the same metrics. `invalid` draws a persistent 1px `error` ring that
// also replaces the brand ring while focused.
const boxVariants = cv({
  base: 'flex min-w-0 items-center gap-2 rounded-sm bg-tertiary text-primary label-xs transition-colors',
  variants: {
    size: {
      sm: 'px-2',
      md: 'px-3',
    },
    invalid: {
      true: 'ring-1 ring-error',
      false: 'focus-within:ring-1 focus-within:ring-brand',
    },
    disabled: {
      true: 'cursor-not-allowed opacity-50',
      false: 'hover:bg-brand/10',
    },
  },
  defaultVariants: { size: 'md', invalid: false, disabled: false },
});

const inputVariants = cv({
  base: 'min-w-0 flex-1 bg-transparent text-primary placeholder:text-tertiary focus:outline-none disabled:cursor-not-allowed',
  variants: {
    size: {
      sm: 'py-1',
      md: 'py-1.5',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface TextFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  /** `change` fires every keystroke; `blur` keeps a draft and fires on blur/Enter. */
  commitOn?: 'blur' | 'change';
  type?: 'text' | 'search' | 'password' | 'email' | 'url';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  trailing?: ReactNode;
  placeholder?: string;
  label?: string;
  labelPlacement?: FieldLabelPlacement;
  error?: string;
  hint?: string;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  maxLength?: number;
  id?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
  /** Runs before internal key handling; `preventDefault()` skips the internal handling. */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  required?: boolean;
  autoComplete?: string;
  spellCheck?: boolean;
  autoCapitalize?: string;
}

export function TextField({
  value,
  onValueChange,
  commitOn = 'change',
  type = 'text',
  size = 'md',
  icon,
  trailing,
  placeholder,
  label,
  labelPlacement,
  error,
  hint,
  disabled,
  readOnly,
  autoFocus,
  selectOnFocus,
  maxLength,
  id,
  className,
  ref,
  onKeyDown,
  required,
  autoComplete,
  spellCheck,
  autoCapitalize,
}: TextFieldProps) {
  const ids = useFieldIds(id, { error, hint });
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const reverting = useRef(false);
  const deferred = commitOn === 'blur';

  // Follow external changes while the user is not editing.
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || !deferred) return;
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
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
      required={required}
      disabled={disabled}
      className={className}
    >
      <div className={boxVariants({ size, invalid: Boolean(error), disabled: Boolean(disabled) })}>
        {icon ? <span className="flex shrink-0 items-center text-tertiary">{icon}</span> : null}
        <input
          ref={ref}
          id={ids.id}
          required={required}
          autoComplete={autoComplete}
          spellCheck={spellCheck}
          autoCapitalize={autoCapitalize}
          type={type}
          value={deferred ? draft : value}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          maxLength={maxLength}
          aria-label={labelPlacement === 'hidden' ? label : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={inputVariants({ size })}
          onChange={(event) => {
            if (deferred) setDraft(event.target.value);
            else onValueChange(event.target.value);
          }}
          onFocus={(event) => {
            focused.current = true;
            if (selectOnFocus) event.currentTarget.select();
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
        {trailing ? <span className="flex shrink-0 items-center text-tertiary">{trailing}</span> : null}
      </div>
    </Field>
  );
}
