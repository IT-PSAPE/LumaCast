import { Select as BaseSelect } from '@base-ui/react/select';
import { cn } from './cn';
import { cv } from './cv';

// The chevron and check glyphs are inlined rather than pulled from an icon
// package: @lumacast/ui may depend only on `@lumacast/kernel`. The paths and
// stroke geometry match lucide's `ChevronDown`/`Check` at 24x24 / stroke-width
// 2, so they render identically to icons the apps already draw from lucide.
function ChevronDownIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

const triggerVariants = cv({
  base: 'inline-flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded-sm bg-tertiary text-primary label-xs transition-colors hover:bg-brand/10 focus:outline-none focus:ring-1 focus:ring-brand data-disabled:cursor-not-allowed data-disabled:pointer-events-none data-disabled:opacity-50',
  variants: {
    size: {
      sm: 'px-2 py-1',
      md: 'px-3 py-1.5',
    },
  },
  defaultVariants: { size: 'md' },
});

const itemStyles = 'flex cursor-pointer select-none items-center justify-between gap-2 rounded label-xs px-2 py-1.5 text-secondary outline-none data-[highlighted]:bg-secondary data-[highlighted]:text-primary data-[selected]:text-brand';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  /** Accessible name for the trigger (there is no visible field label). */
  label?: string;
}

export function Select<T extends string>({ value, onValueChange, options, placeholder, disabled, className, size = 'md', label }: SelectProps<T>) {
  const selected = options.find((option) => option.value === value);

  return (
    <BaseSelect.Root
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next as T);
      }}
    >
      <BaseSelect.Trigger aria-label={label} className={cn(triggerVariants({ size }), className)}>
        <BaseSelect.Value className="flex-1 truncate text-left">{selected?.label ?? placeholder ?? value}</BaseSelect.Value>
        <BaseSelect.Icon className="shrink-0 text-tertiary">
          <ChevronDownIcon />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="z-[60] outline-none">
          <BaseSelect.Popup className="max-h-80 min-w-[var(--anchor-width)] overflow-y-auto rounded-md border border-primary bg-primary p-1 shadow-lg">
            {options.map((option) => (
              <BaseSelect.Item key={option.value} value={option.value} disabled={option.disabled} className={itemStyles}>
                <BaseSelect.ItemText className="flex-1 truncate">{option.label}</BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className="shrink-0">
                  <CheckIcon />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
