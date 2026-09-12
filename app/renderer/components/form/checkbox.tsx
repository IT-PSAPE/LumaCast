import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { createContext, useContext, useId, type ComponentPropsWithoutRef, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

// Only Label needs the generated id (to point `aria-labelledby` at itself);
// Root/Indicator get checked/disabled straight from Base UI's own state.
interface CheckboxMetaValue {
  inputId: string;
}

const CheckboxMetaContext = createContext<CheckboxMetaValue | null>(null);

function useCheckboxMeta() {
  const context = useContext(CheckboxMetaContext);
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

// Base UI's Checkbox.Root is itself the focusable, clickable box
// (role="checkbox"), so the border/background that used to live on our
// Indicator now live here; Indicator keeps only the checkmark, matching
// Base UI's own Root+Indicator split.
const checkboxBoxStyles = cv({
  base: 'grid h-4 w-4 shrink-0 place-items-center rounded border outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
  variants: {
    checked: {
      true: 'border-brand bg-brand/15 text-brand',
      false: 'border-primary bg-primary text-transparent',
    },
  },
  defaultVariants: {
    checked: false,
  },
});

interface CheckboxRootProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'checked' | 'defaultChecked' | 'onChange' | 'type' | 'value'> {
  checked?: boolean;
  children: ReactNode;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

function Root({ checked, children, className, defaultChecked = false, disabled = false, id, onCheckedChange, ...inputProps }: CheckboxRootProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <CheckboxMetaContext.Provider value={{ inputId }}>
      <label className={cn('group', checkboxRootStyles({ disabled, className }))}>
        <BaseCheckbox.Root
          {...(inputProps as ComponentPropsWithoutRef<typeof BaseCheckbox.Root>)}
          id={inputId}
          checked={checked}
          defaultChecked={defaultChecked}
          disabled={disabled}
          onCheckedChange={(nextChecked) => onCheckedChange?.(nextChecked)}
          aria-labelledby={`${inputId}-label`}
          className={(state) => checkboxBoxStyles({ checked: state.checked })}
        >
          {children}
        </BaseCheckbox.Root>
      </label>
    </CheckboxMetaContext.Provider>
  );
}

function Indicator({ children, className, ...rest }: LabelHTMLAttributes<HTMLSpanElement>) {
  return (
    <BaseCheckbox.Indicator {...rest} aria-hidden="true" className={className}>
      {children ?? <Check size={11} strokeWidth={2.5} />}
    </BaseCheckbox.Indicator>
  );
}

function Label({ children, className, ...rest }: LabelHTMLAttributes<HTMLSpanElement>) {
  const { inputId } = useCheckboxMeta();

  return (
    <span {...rest} className={cn('min-w-0', className)} id={`${inputId}-label`}>
      {children}
    </span>
  );
}

export const Checkbox = { Root, Indicator, Label };
