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
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-tertiary transition-colors data-[checked]:bg-brand data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className,
      )}
    >
      <BaseSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-primary transition-transform data-[checked]:translate-x-[18px]" />
    </BaseSwitch.Root>
  );
}
