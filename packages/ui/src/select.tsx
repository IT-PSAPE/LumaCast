import { Select as BaseSelect } from '@base-ui/react/select';
import { useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { cn } from './cn';
import { cv } from './cv';
import { Field, useFieldIds, type FieldLabelPlacement } from './field';
import { useOverlayContainer, useOverlayStackEntry } from './overlay';

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
  base: 'inline-flex min-w-0 cursor-pointer items-center justify-between gap-2 rounded-sm bg-tertiary text-primary label-xs transition-colors focus:outline-none data-disabled:cursor-not-allowed data-disabled:pointer-events-none data-disabled:opacity-50',
  variants: {
    size: {
      sm: 'px-2 py-1',
      md: 'px-3 py-1.5',
    },
    // Matches TextField: a persistent 1px `error` ring that replaces the brand
    // focus ring.
    invalid: {
      true: 'ring-1 ring-error',
      false: 'hover:bg-brand/10 focus:ring-1 focus:ring-brand',
    },
  },
  defaultVariants: { size: 'md', invalid: false },
});

const itemStyles = 'flex cursor-pointer select-none items-center justify-between gap-2 rounded label-xs px-2 py-1.5 text-secondary outline-none data-[highlighted]:bg-secondary data-[highlighted]:text-primary data-[selected]:text-brand data-disabled:cursor-not-allowed data-disabled:opacity-50';

/**
 * A plain-string label needs nothing more. A rich (non-string) label must also
 * supply `textValue`: typeahead and the option's accessible name use real text.
 */
export type SelectOption<T = string> =
  | { value: T; label: string; textValue?: undefined; disabled?: boolean }
  | { value: T; label: ReactNode; textValue: string; disabled?: boolean };

export interface SelectGroup<T = string> {
  label: string;
  options: ReadonlyArray<SelectOption<T>>;
}

export interface SelectProps<T = string> {
  value: T;
  onValueChange: (value: T) => void;
  /** Flat options, or labelled groups (heading rows are not selectable). */
  options: ReadonlyArray<SelectOption<T>> | ReadonlyArray<SelectGroup<T>>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md';
  /** Field label; with `labelPlacement="hidden"` it is only the accessible name. Without a label it is the trigger's aria-label. */
  label?: string;
  labelPlacement?: FieldLabelPlacement;
  error?: string;
  hint?: string;
  id?: string;
  /** Fires when focus genuinely leaves the closed Select; blurs caused by the popup opening are ignored. */
  onBlur?: (event: FocusEvent) => void;
}

function isGroupList<T>(options: ReadonlyArray<SelectOption<T>> | ReadonlyArray<SelectGroup<T>>): options is ReadonlyArray<SelectGroup<T>> {
  const first = options[0];
  return first !== undefined && 'options' in first && Array.isArray(first.options);
}

export function Select<T = string>({ value, onValueChange, options, placeholder, disabled, className, size = 'md', label, labelPlacement, error, hint, id, onBlur }: SelectProps<T>) {
  const ids = useFieldIds(id, { error, hint });
  const [open, setOpen] = useState(false);
  // Synchronous mirror of `open`: the trigger blurs as the popup opens, before state commits.
  const openRef = useRef(false);
  const { zIndex } = useOverlayStackEntry(open);
  const container = useOverlayContainer();

  // Base UI keys items by string, so any T is mapped through its flat index.
  const groups: ReadonlyArray<{ label?: string; options: ReadonlyArray<SelectOption<T>> }> = isGroupList(options) ? options : [{ options }];
  const flat = groups.flatMap((group) => group.options);
  const selectedIndex = flat.findIndex((option) => Object.is(option.value, value));
  const selected = flat[selectedIndex];
  const display = selected?.label ?? placeholder ?? (typeof value === 'string' ? value : '');
  let cursor = 0;

  return (
    <Field label={label} labelPlacement={labelPlacement} htmlFor={ids.id} error={error} hint={hint} disabled={disabled} className={className}>
      <BaseSelect.Root
        value={selectedIndex >= 0 ? String(selectedIndex) : null}
        disabled={disabled}
        open={open}
        onOpenChange={(next) => {
          openRef.current = next;
          setOpen(next);
        }}
        onValueChange={(next) => {
          const option = typeof next === 'string' ? flat[Number(next)] : undefined;
          if (option) onValueChange(option.value);
        }}
      >
        <BaseSelect.Trigger
          id={ids.id}
          aria-label={label && labelPlacement !== 'hidden' ? undefined : label}
          onBlur={onBlur ? (event) => { if (!openRef.current) onBlur(event); } : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
          className={cn(triggerVariants({ size, invalid: Boolean(error) }), 'w-full')}
        >
          <BaseSelect.Value className="flex-1 truncate text-left">{display}</BaseSelect.Value>
          <BaseSelect.Icon className="shrink-0 text-tertiary">
            <ChevronDownIcon />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal container={container}>
          <BaseSelect.Positioner sideOffset={4} className="outline-none" style={{ zIndex }}>
            <BaseSelect.Popup className="max-h-80 min-w-[var(--anchor-width)] overflow-y-auto rounded-md border border-primary bg-primary p-1 shadow-lg">
              {groups.map((group, groupIndex) => {
                const items = group.options.map((option) => {
                  const index = cursor++;
                  return (
                    <BaseSelect.Item key={index} value={String(index)} label={option.textValue ?? (typeof option.label === 'string' ? option.label : undefined)} aria-label={option.textValue} disabled={option.disabled} className={itemStyles}>
                      <BaseSelect.ItemText className="flex-1 truncate">{option.label}</BaseSelect.ItemText>
                      <BaseSelect.ItemIndicator className="shrink-0">
                        <CheckIcon />
                      </BaseSelect.ItemIndicator>
                    </BaseSelect.Item>
                  );
                });
                if (group.label === undefined) return items;
                return (
                  <BaseSelect.Group key={groupIndex}>
                    <BaseSelect.GroupLabel className="px-2 py-1 label-xs text-tertiary">{group.label}</BaseSelect.GroupLabel>
                    {items}
                  </BaseSelect.Group>
                );
              })}
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </Field>
  );
}
