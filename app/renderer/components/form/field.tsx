import { Children, isValidElement, useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEventHandler, type ReactElement, type ReactNode, type Ref } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Field as BaseField } from '@base-ui/react/field';
import { Input as BaseInput } from '@base-ui/react/input';
import { NumberField } from '@base-ui/react/number-field';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { cn } from '@renderer/utils/cn';
import { useWorkbench } from '@renderer/contexts/workbench-context';
import { Dropdown } from './dropdown';

type ColorMode = 'solid' | 'gradient' | 'image';

// The visible focus indicator for every field surface: a ring (not a border-color
// swap), per the twelve-token styling contract.
const FOCUS_RING = 'focus-within:ring-1 focus-within:ring-brand';

function toPickerHex(value: string): string {
  const hex = value.startsWith('#') ? value.slice(1) : value;
  return `#${hex.slice(0, 6).padEnd(6, '0')}`;
}

function displayHex(value: string): string {
  return value.startsWith('#') ? value.slice(1).toUpperCase() : value.toUpperCase();
}

// NumberField.Root wants a numeric value; the raw-string contract callers rely on
// (partial/invalid text mid-edit, e.g. "-", "12.", "") maps to `null` here and back
// to `''` on the way out — the field's own `inputValue` state keeps showing exactly
// what was typed regardless of what this resolves to.
function toNullableNumber(raw: string | number): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function FieldLabel({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={cn('flex flex-col min-w-0 gap-0.5 text-sm text-secondary', wide && 'col-span-full')}>
      <span className="truncate">{label}</span>
      {children}
    </label>
  );
}

function FieldIcon({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={className} {...rest}>
      {children}
    </span>
  );
}

interface FieldInputProps {
  children?: ReactNode;
  disabled?: boolean;
  type?: 'number' | 'text' | 'password';
  value: string | number;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  wide?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  wrapperClassName?: string;
  iconClassName?: string;
  inputClassName?: string;
  ariaLabel?: string;
}

function FieldInput({ children, disabled = false, type = 'text', value, onChange, onBlur, onKeyDown, placeholder, min, max, step, label, wide, inputRef, wrapperClassName, iconClassName, inputClassName, ariaLabel }: FieldInputProps) {
  const icon = extractFieldIcon(children);
  const iconNode = icon ? <span className={cn('flex justify-center items-center shrink-0 size-6 ml-1 text-secondary', iconClassName)}>{icon}</span> : null;
  const boxClassName = cn('flex min-w-0 w-full items-center min-h-8 rounded bg-tertiary text-sm text-primary transition-colors', FOCUS_RING, wrapperClassName);
  const controlClassName = cn('min-w-0 w-full bg-transparent py-1 pr-2 outline-none disabled:cursor-not-allowed disabled:opacity-50', icon ? 'pl-1' : 'pl-2', inputClassName);

  let control: ReactNode;
  if (type === 'number') {
    const numericValue = toNullableNumber(value);
    control = (
      <NumberField.Root
        value={numericValue}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={boxClassName}
        // Direct typing must stay unclamped so an out-of-range raw string
        // (e.g. "-1" against min=0) still reaches consumers verbatim — several
        // callers (audio-sync-editor.tsx) reject it themselves. Only the
        // interactive paths (arrow keys, buttons, wheel) still clamp.
        allowOutOfRange
        // Bridges the parts of the interaction NumberField handles imperatively
        // (arrow-key stepping, paste, blur-driven reformat) — none of these fire a
        // native `change` event, so the raw-text hook below never sees them.
        onValueChange={(next) => onChange(next === null ? '' : String(next))}
      >
        {iconNode}
        <NumberField.Input
          ref={inputRef}
          placeholder={placeholder}
          aria-label={ariaLabel}
          // A native <input type="number"> is an ARIA spinbutton; Base UI's
          // NumberField.Input renders type="text" (for formatting/masking) so it
          // would otherwise pick up the implicit "textbox" role and collide with
          // unrelated textboxes on the page (e.g. the canvas's rich-text editor).
          // Restoring role=spinbutton with its value attrs is both the correct
          // semantics and the fix.
          role="spinbutton"
          aria-valuenow={numericValue ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          // Runs before NumberField's own onChange (Base UI composes user handlers
          // first), so this always sees the exact keystroke text — including
          // partial/invalid states the numeric bridge above cannot represent.
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          className={cn(controlClassName, '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none')}
        />
      </NumberField.Root>
    );
  } else {
    control = (
      <div className={boxClassName}>
        {iconNode}
        <BaseInput
          ref={inputRef}
          type={type === 'password' ? 'password' : 'text'}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={controlClassName}
        />
      </div>
    );
  }

  if (!label) return control;
  return (
    <BaseField.Root className={cn('flex flex-col min-w-0 gap-0.5', wide && 'col-span-full')}>
      <BaseField.Label className="truncate text-sm text-secondary">{label}</BaseField.Label>
      {control}
    </BaseField.Root>
  );
}

interface FieldSelectProps {
  children?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  options?: Array<{ value: string; label: string; style?: CSSProperties }>;
  label?: string;
  wide?: boolean;
}

interface FieldSelectOptionProps {
  value: string;
  children: ReactNode;
  style?: CSSProperties;
}

function FieldSelectOption({ value, children, style }: FieldSelectOptionProps) {
  return (
    <BaseSelect.Item
      value={value}
      className="flex cursor-pointer select-none gap-2 rounded px-2 py-1.5 text-sm text-secondary outline-none data-[highlighted]:bg-secondary data-[highlighted]:text-primary"
    >
      <BaseSelect.ItemText style={style}>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
}

function FieldSelectRoot({ children, value, onChange, onBlur, options, label, wide }: FieldSelectProps) {
  const icon = extractFieldIcon(children);
  const optionParts = Children.toArray(children).filter(
    (child): child is ReactElement<FieldSelectOptionProps> => isValidElement<FieldSelectOptionProps>(child) && child.type === FieldSelectOption,
  );
  const selectItems = [
    ...optionParts.map((option) => ({
      value: option.props.value,
      label: option.props.children,
    })),
    ...(options ?? []),
  ];
  const { overlayStack } = useWorkbench();
  const { register, unregister } = overlayStack;
  const selectId = useId();
  const [open, setOpen] = useState(false);

  // Participate in the global overlay stack exactly like Popover-backed menus, so a
  // select opened from inside a dialog layers above it. See popover.tsx for the
  // z-index convention this mirrors.
  useEffect(() => {
    if (!open) return undefined;
    register(selectId);
    return () => unregister(selectId);
  }, [open, selectId, register, unregister]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) onBlur?.();
  }

  const stackIndex = overlayStack.stack.indexOf(selectId);
  const zIndex = overlayStack.baseZIndex + Math.max(stackIndex, 0) * 10;

  const control = (
    <BaseSelect.Root
      items={selectItems}
      value={value}
      onValueChange={(next) => { if (typeof next === 'string') onChange(next); }}
      onOpenChange={handleOpenChange}
    >
      <div className="flex min-w-0 w-full items-center">
        {icon ? <span className="flex justify-center items-center shrink-0 size-6 ml-1 text-secondary">{icon}</span> : null}
        <BaseSelect.Trigger className="flex min-w-0 w-full items-center min-h-8 rounded bg-tertiary text-sm text-primary transition-colors focus:outline-none focus:ring-1 focus:ring-brand cursor-pointer">
          <BaseSelect.Value className="truncate flex-1 px-1.5 text-left" />
          <BaseSelect.Icon className="shrink-0 mr-1.5 text-tertiary">
            <ChevronDown className="size-3.5" />
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
      </div>
      <BaseSelect.Portal container={overlayStack.rootElement}>
        <BaseSelect.Positioner sideOffset={4} className="pointer-events-auto outline-none select-none" style={{ zIndex }}>
          <BaseSelect.Popup
            data-popover-content="true"
            className="min-w-[var(--anchor-width)] rounded-md border border-primary bg-primary p-1 shadow-lg max-h-[min(32rem,70vh)] overflow-y-auto"
          >
            <BaseSelect.List>
              {optionParts}
              {options?.map((option) => (
                <FieldSelectOption key={option.value} value={option.value} style={option.style}>
                  {option.label}
                </FieldSelectOption>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );

  if (!label) return control;
  return (
    <BaseField.Root className={cn('flex flex-col min-w-0 gap-0.5', wide && 'col-span-full')}>
      {/* nativeLabel=false + render as a <span>: the control is Select.Trigger (a
          button), and a real <label> would bleed :hover onto it and double-fire
          clicks — see field.md / Field.Label's nativeLabel doc and select.md's
          "Labeling a select". Association still works via aria-labelledby. */}
      <BaseField.Label nativeLabel={false} render={<span />} className="truncate text-sm text-secondary">{label}</BaseField.Label>
      {control}
    </BaseField.Root>
  );
}

const FieldSelect = Object.assign(FieldSelectRoot, { Option: FieldSelectOption });

interface FieldTextareaProps {
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder?: string;
  className?: string;
  label?: string;
  resize?: 'none' | 'vertical';
  rows?: number;
  textareaRef?: Ref<HTMLTextAreaElement>;
  wide?: boolean;
}

// No Base UI part covers a multi-line textarea (Field.Control renders an <input>
// unless overridden), so this stays a plain, wrapping-<label>-associated native
// <textarea> — unchanged from before this migration.
function FieldTextarea({ disabled = false, value, onChange, onFocus, onBlur, onKeyDown, placeholder, className = '', label, resize = 'vertical', rows, textareaRef, wide }: FieldTextareaProps) {
  function handleValueChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
  }

  const resizeClassName = resize === 'none' ? 'resize-none' : 'resize-y';
  const textarea = (
    <textarea
      ref={textareaRef}
      value={value}
      rows={rows}
      disabled={disabled}
      onChange={handleValueChange}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={cn(`min-w-0 w-full rounded border border-primary bg-primary px-1.5 py-1 text-primary min-h-[60px] focus:border-brand focus:outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50`, resizeClassName, className)}
    />
  );

  if (!label) return textarea;
  return <FieldLabel label={label} wide={wide}>{textarea}</FieldLabel>;
}

interface FieldColorProps {
  value: string | null | undefined;
  onChange: (value: string) => void;
  label?: string;
  wide?: boolean;
  mode?: ColorMode;
  onModeChange?: (mode: ColorMode) => void;
}

function FieldColor({ value, onChange, label, wide, mode = 'solid', onModeChange }: FieldColorProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const safeValue = typeof value === 'string' && value.length > 0 ? value : '#000000';

  function handlePickerChange(event: React.ChangeEvent<HTMLInputElement>) {
    const alpha = safeValue.length > 7 ? safeValue.slice(7) : '';
    onChange(event.target.value + alpha);
  }

  function handleHexInput(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value.replace(/[^0-9a-fA-F]/g, '');
    onChange(`#${raw}`);
  }

  function handleSwatchClick() {
    pickerRef.current?.click();
  }

  function handleModeChange(v: ColorMode) {
    onModeChange?.(v);
  }

  const colorField = (
    <div className={cn('flex min-w-0 w-full items-center gap-1.5 min-h-8 rounded bg-tertiary text-sm text-primary transition-colors', FOCUS_RING)}>
      <button type="button" onClick={handleSwatchClick} aria-label="Choose colour" className="ml-1.5 size-5 shrink-0 rounded border border-primary cursor-pointer" style={{ backgroundColor: toPickerHex(safeValue) }} />
      <input ref={pickerRef} type="color" value={toPickerHex(safeValue)} onChange={handlePickerChange} className="sr-only" tabIndex={-1} aria-hidden="true" />
      <span className="text-tertiary text-sm select-none">#</span>
      <BaseInput type="text" value={displayHex(safeValue)} onChange={handleHexInput} maxLength={8} aria-label="Hex color" className="min-w-0 w-full bg-transparent py-1 pr-2 outline-none font-mono text-sm" />
      {onModeChange ? (
        <Dropdown className="shrink-0">
          <Dropdown.Trigger className="flex items-center py-1 rounded-sm bg-tertiary text-sm text-primary cursor-pointer">
            <span className="truncate px-1.5">
              {mode === 'solid' && 'Solid'}
              {mode === 'gradient' && 'Gradient'}
              {mode === 'image' && 'Image'}
            </span>
            <ChevronDown className="shrink-0 size-3.5 mr-1.5 text-tertiary" />
          </Dropdown.Trigger>
          <Dropdown.Panel>
            <Dropdown.Item onClick={() => handleModeChange('solid')}>Solid</Dropdown.Item>
            <Dropdown.Item onClick={() => handleModeChange('gradient')}>Gradient</Dropdown.Item>
            <Dropdown.Item onClick={() => handleModeChange('image')}>Image</Dropdown.Item>
          </Dropdown.Panel>
        </Dropdown>
      ) : null}
    </div>
  );

  if (!label) return colorField;
  return (
    <BaseField.Root className={cn('flex flex-col min-w-0 gap-0.5', wide && 'col-span-full')}>
      <BaseField.Label className="truncate text-sm text-secondary">{label}</BaseField.Label>
      {colorField}
    </BaseField.Root>
  );
}

function FieldCheckbox({ checked, className, disabled = false, label, onChange }: { checked: boolean; className?: string; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className={cn('group inline-flex items-center gap-2 text-sm text-secondary', disabled && 'opacity-50', className)}>
      <BaseCheckbox.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="grid size-4 shrink-0 place-items-center rounded border border-primary bg-primary text-transparent transition-colors data-[checked]:border-brand data-[checked]:bg-brand/15 data-[checked]:text-brand group-focus-within:outline-2 group-focus-within:outline-offset-1 group-focus-within:outline-brand"
      >
        <BaseCheckbox.Indicator>
          <Check size={11} strokeWidth={2.5} />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {label}
    </label>
  );
}

function extractFieldIcon(children: ReactNode): ReactNode {
  let icon: ReactNode = null;

  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type !== FieldIcon) return;
    icon = child.props.children;
  });

  return icon;
}

export const Field = { Label: FieldLabel, Icon: FieldIcon, Input: FieldInput, Select: FieldSelect, Textarea: FieldTextarea, Color: FieldColor, Checkbox: FieldCheckbox };
export { FieldLabel, FieldIcon, FieldInput, FieldSelect, FieldTextarea, FieldColor, FieldCheckbox };
