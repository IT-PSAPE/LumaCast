import { Children, isValidElement, type CSSProperties, type HTMLAttributes, type KeyboardEventHandler, type ReactNode, type Ref } from 'react';
import { useRef } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@renderer/utils/cn';
import { Dropdown } from './dropdown';
import { Checkbox } from './checkbox';

type ColorMode = 'solid' | 'gradient' | 'image';

const FILL_MODE_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image', label: 'Image' },
];

function toPickerHex(value: string): string {
  const hex = value.startsWith('#') ? value.slice(1) : value;
  return `#${hex.slice(0, 6).padEnd(6, '0')}`;
}

function displayHex(value: string): string {
  return value.startsWith('#') ? value.slice(1).toUpperCase() : value.toUpperCase();
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

function FieldInput({ children, disabled = false, type = 'text', value, onChange, onBlur, onKeyDown, placeholder, min, max, step, label, wide, inputRef, wrapperClassName, iconClassName, inputClassName, ariaLabel }: { children?: ReactNode; disabled?: boolean; type?: 'number' | 'text'; value: string | number; onChange: (value: string) => void; onBlur?: () => void; onKeyDown?: KeyboardEventHandler<HTMLInputElement>; placeholder?: string; min?: number; max?: number; step?: number; label?: string; wide?: boolean; inputRef?: Ref<HTMLInputElement>; wrapperClassName?: string; iconClassName?: string; inputClassName?: string; ariaLabel?: string }) {
  function handleValueChange(event: React.ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  const icon = extractFieldIcon(children);
  const input = (
    <div className={cn('flex min-w-0 w-full items-center min-h-8 rounded bg-tertiary text-sm text-primary transition-colors focus-within:border-brand', wrapperClassName)}>
      {icon ? <span className={cn('flex justify-center items-center shrink-0 size-6 ml-1 text-secondary', iconClassName)}>{icon}</span> : null}
      <input
        ref={inputRef}
        type={type}
        value={value}
        disabled={disabled}
        onChange={handleValueChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        className={cn('min-w-0 w-full bg-transparent py-1 pr-2 outline-none disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', icon ? 'pl-1' : 'pl-2', inputClassName)}
      />
    </div>
  );

  if (!label) return input;
  return <FieldLabel label={label} wide={wide}>{input}</FieldLabel>;
}

function FieldSelect({ children, value, onChange, onBlur, options, label, wide }: { children?: ReactNode; value: string; onChange: (value: string) => void; onBlur?: () => void; options: Array<{ value: string; label: string; style?: CSSProperties }>; label?: string; wide?: boolean }) {
  const selectedLabel = options.find((o) => o.value === value)?.label ?? '';
  const icon = extractFieldIcon(children);

  const select = (
    <div className="flex min-w-0 w-full items-center">
      {icon ? <span className="flex justify-center items-center shrink-0 size-6 ml-1 text-secondary">{icon}</span> : null}
      <Dropdown className="w-full">
        <Dropdown.Trigger className="flex min-w-0 w-full items-center min-h-8 rounded bg-tertiary text-sm text-primary transition-colors focus:outline-none focus:ring-1 focus:ring-brand cursor-pointer">
          <span className="truncate flex-1 px-1.5 text-left">{selectedLabel}</span>
          <ChevronDown className="shrink-0 size-3.5 mr-1.5 text-tertiary" />
        </Dropdown.Trigger>
        <Dropdown.Panel>
          {options.map((opt) => <Dropdown.Item key={opt.value} onClick={() => { onChange(opt.value); onBlur?.(); }}>{opt.label}</Dropdown.Item>)}
        </Dropdown.Panel>
      </Dropdown>
    </div>
  );

  if (!label) return select;
  return <FieldLabel label={label} wide={wide}>{select}</FieldLabel>;
}

function FieldTextarea({ disabled = false, value, onChange, onFocus, onBlur, onKeyDown, placeholder, className = '', label, resize = 'vertical', rows, textareaRef, wide }: { disabled?: boolean; value: string; onChange: (value: string) => void; onFocus?: () => void; onBlur?: () => void; onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>; placeholder?: string; className?: string; label?: string; resize?: 'none' | 'vertical'; rows?: number; textareaRef?: Ref<HTMLTextAreaElement>; wide?: boolean }) {
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

function FieldColor({ value, onChange, label, wide, mode = 'solid', onModeChange }: { value: string | null | undefined; onChange: (value: string) => void; label?: string; wide?: boolean; mode?: ColorMode; onModeChange?: (mode: ColorMode) => void }) {
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

  function handleModeChange(v: string) {
    onModeChange?.(v as ColorMode);
  }

  const colorField = (
    <div className="flex min-w-0 w-full items-center gap-1.5 min-h-8 rounded bg-tertiary text-sm text-primary transition-colors focus-within:border-brand">
      <button type="button" onClick={handleSwatchClick} className="ml-1.5 size-5 shrink-0 rounded border border-primary cursor-pointer" style={{ backgroundColor: toPickerHex(safeValue) }} />
      <input ref={pickerRef} type="color" value={toPickerHex(safeValue)} onChange={handlePickerChange} className="sr-only" tabIndex={-1} />
      <span className="text-tertiary text-sm select-none">#</span>
      <input type="text" value={displayHex(safeValue)} onChange={handleHexInput} maxLength={8} className="min-w-0 w-full bg-transparent py-1 pr-2 outline-none font-mono text-sm" />
      {onModeChange ? (
        <Dropdown className="shrink-0">
          <Dropdown.Trigger className="flex items-center py-1 rounded-sm bg-tertiary text-sm text-primary cursor-pointer">
            <span className="truncate px-1.5">{FILL_MODE_OPTIONS.find((o) => o.value === mode)?.label}</span>
            <ChevronDown className="shrink-0 size-3.5 mr-1.5 text-tertiary" />
          </Dropdown.Trigger>
          <Dropdown.Panel>
            {FILL_MODE_OPTIONS.map((opt) => <Dropdown.Item key={opt.value} onClick={() => handleModeChange(opt.value)}>{opt.label}</Dropdown.Item>)}
          </Dropdown.Panel>
        </Dropdown>
      ) : null}
    </div>
  );

  if (!label) return colorField;
  return <FieldLabel label={label} wide={wide}>{colorField}</FieldLabel>;
}

function FieldCheckbox({ checked, className, disabled = false, label, onChange }: { checked: boolean; className?: string; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <Checkbox.Root checked={checked} disabled={disabled} onCheckedChange={onChange} className={className}>
      <Checkbox.Indicator>{checked ? <Check size={11} strokeWidth={2.5} /> : null}</Checkbox.Indicator>
      <Checkbox.Label>{label}</Checkbox.Label>
    </Checkbox.Root>
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
