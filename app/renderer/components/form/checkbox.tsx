import { Check } from 'lucide-react';
import { createContext, useContext, useId, useMemo, useState, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

interface CheckboxContextValue {
  state: { checked: boolean; disabled: boolean };
  actions: { setChecked: (checked: boolean) => void };
  meta: { inputId: string };
}

const CheckboxContext = createContext<CheckboxContextValue | null>(null);

function useCheckbox() {
  const context = useContext(CheckboxContext);
  if (!context) throw new Error('Checkbox sub-components must be used within Checkbox.Root');
  return context;
}

const checkboxRootStyles = cv({
  base: 'inline-flex items-center gap-2 text-sm text-secondary',
  variants: {
    disabled: {
      true: 'opacity-50',
      false: null,
    },
  },
  defaultVariants: {
    disabled: false,
  },
});

const checkboxIndicatorStyles = cv({
  base: 'grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors',
  variants: {
    checked: {
      true: 'border-brand bg-brand/15 text-brand',
      false: 'border-primary bg-primary text-transparent',
    },
    disabled: {
      true: null,
      false: 'group-focus-within:outline-2 group-focus-within:outline-offset-1 group-focus-within:outline-border-brand',
    },
  },
  defaultVariants: {
    checked: false,
    disabled: false,
  },
});

interface CheckboxRootProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'checked' | 'defaultChecked' | 'onChange' | 'type'> {
  checked?: boolean;
  children: ReactNode;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

function Root({ checked, children, className, defaultChecked = false, disabled = false, id, onCheckedChange, ...inputProps }: CheckboxRootProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const resolvedChecked = isControlled ? checked : internalChecked;

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextChecked = event.target.checked;
    if (!isControlled) setInternalChecked(nextChecked);
    onCheckedChange?.(nextChecked);
  }

  const value = useMemo<CheckboxContextValue>(() => ({
    state: { checked: resolvedChecked, disabled },
    actions: { setChecked: onCheckedChange ?? (() => undefined) },
    meta: { inputId },
  }), [disabled, inputId, onCheckedChange, resolvedChecked]);

  return (
    <CheckboxContext.Provider value={value}>
      <label className={cn('group', checkboxRootStyles({ disabled, className }))}>
        <input
          {...inputProps}
          id={inputId}
          type="checkbox"
          checked={resolvedChecked}
          disabled={disabled}
          onChange={handleChange}
          className="sr-only"
        />
        {children}
      </label>
    </CheckboxContext.Provider>
  );
}

function Indicator({ children, className, ...rest }: LabelHTMLAttributes<HTMLSpanElement>) {
  const { state } = useCheckbox();

  return (
    <span {...rest} aria-hidden="true" className={checkboxIndicatorStyles({ checked: state.checked, disabled: state.disabled, className })}>
      {children ?? (state.checked ? <Check size={11} strokeWidth={2.5} /> : null)}
    </span>
  );
}

function Label({ children, className, ...rest }: LabelHTMLAttributes<HTMLSpanElement>) {
  const { meta } = useCheckbox();

  return (
    <span {...rest} className={cn('min-w-0', className)} id={`${meta.inputId}-label`}>
      {children}
    </span>
  );
}

export const Checkbox = { Root, Indicator, Label };
