import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { cn } from './cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name (there is no visible field label). */
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  return (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-tertiary transition-colors data-[checked]:bg-brand data-disabled:cursor-not-allowed data-disabled:opacity-50 motion-reduce:transition-none',
        'forced-colors:forced-color-adjust-none forced-colors:border-[ButtonText] forced-colors:bg-[Canvas] forced-colors:data-[checked]:bg-[Canvas] forced-colors:data-disabled:border-[GrayText] forced-colors:data-disabled:opacity-100',
        className,
      )}
    >
      <BaseSwitch.Thumb className="block size-4 translate-x-px rounded-full bg-primary transition-transform data-[checked]:translate-x-[17px] motion-reduce:transition-none forced-colors:bg-[ButtonText] forced-colors:data-[checked]:bg-[Highlight] forced-colors:data-disabled:bg-[GrayText] forced-colors:data-[checked]:data-disabled:bg-[GrayText]" />
    </BaseSwitch.Root>
  );
}
