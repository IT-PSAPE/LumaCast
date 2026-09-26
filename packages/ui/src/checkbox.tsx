import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { cn } from './cn';

// The check glyph is inlined rather than pulled from an icon package:
// @lumacast/ui may depend only on `@lumacast/kernel`. The path and stroke
// geometry match lucide's `Check` at 24x24 / stroke-width 2.
function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

// Wrapping the root in a native `<label>` gives the hidden input Base UI
// renders beside the box a click target for free (the same trick a native
// `<input type="checkbox">` relies on). The rendered control's accessible
// role lives on Base UI's own `<span>` rather than that hidden input though,
// so label-wrapping alone does not reach it — `aria-label` is set directly
// so the control has a real accessible name regardless of DOM association.
export function Checkbox({ checked, onCheckedChange, label, disabled, className }: CheckboxProps) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-1.5 label-xs text-secondary',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <BaseCheckbox.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={label}
        className="flex size-4 shrink-0 items-center justify-center rounded-sm border border-primary bg-tertiary text-transparent transition-colors data-[checked]:border-brand data-[checked]:bg-brand data-[checked]:text-white data-disabled:cursor-not-allowed"
      >
        <BaseCheckbox.Indicator keepMounted={false} className="flex items-center justify-center">
          <CheckIcon />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {label ? <span>{label}</span> : null}
    </label>
  );
}
