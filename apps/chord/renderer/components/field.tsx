// Small, self-contained form primitives shared across the inspector and top
// bar. Deliberately lighter than Cast's `components/form/field.tsx`: no
// overlay-stack/workbench context, since Chord never nests a select inside a
// popover inside a dialog — a fixed z-index above the modal is enough.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn, Select, Switch } from '@lumacast/ui';

function clampNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

const FIELD_BOX = 'flex min-h-8 min-w-0 items-center gap-1.5 rounded-sm bg-tertiary px-2 transition-colors focus-within:ring-1 focus-within:ring-brand';

// ── NumberField ──────────────────────────────────────────────────────────

export interface NumberFieldProps {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  ariaLabel?: string;
  icon?: ReactNode;
  suffix?: string;
  className?: string;
}

/** Commits on blur/Enter; ArrowUp/ArrowDown step by `step` (×10 with Shift). */
export function NumberField({ value, onCommit, min, max, step = 1, disabled, ariaLabel, icon, suffix, className }: NumberFieldProps) {
  const [draft, setDraft] = useState(() => formatNumber(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(formatNumber(value));
  }, [value]);

  function commit(next: number) {
    const clamped = clampNumber(next, min, max);
    setDraft(formatNumber(clamped));
    onCommit(clamped);
  }

  function handleBlur() {
    focused.current = false;
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && draft.trim() !== '') commit(parsed);
    else setDraft(formatNumber(value));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      setDraft(formatNumber(value));
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const base = Number.isFinite(Number(draft)) ? Number(draft) : value;
      const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1);
      commit(base + delta);
    }
  }

  return (
    <div className={cn(FIELD_BOX, disabled && 'opacity-50', className)}>
      {icon ? <span className="flex shrink-0 items-center text-tertiary">{icon}</span> : null}
      <input
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        disabled={disabled}
        value={draft}
        onFocus={() => { focused.current = true; }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="label-xs w-full min-w-0 bg-transparent text-primary outline-none"
      />
      {suffix ? <span className="label-xs shrink-0 text-tertiary">{suffix}</span> : null}
    </div>
  );
}

// ── TextField ────────────────────────────────────────────────────────────

export interface TextFieldProps {
  value: string;
  onCommit: (value: string) => void;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  icon?: ReactNode;
  className?: string;
  monospace?: boolean;
  autoFocus?: boolean;
}

/** Commits on blur/Enter; `onChange` (if given) fires on every keystroke too. */
export function TextField({ value, onCommit, onChange, placeholder, disabled, ariaLabel, icon, className, monospace, autoFocus }: TextFieldProps) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  function commit() {
    if (draft !== value) onCommit(draft);
  }

  return (
    <div className={cn(FIELD_BOX, disabled && 'opacity-50', className)}>
      {icon ? <span className="flex shrink-0 items-center text-tertiary">{icon}</span> : null}
      <input
        type="text"
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={placeholder}
        autoFocus={autoFocus}
        value={draft}
        onFocus={() => { focused.current = true; }}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange?.(event.target.value);
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
        className={cn('label-xs w-full min-w-0 bg-transparent text-primary outline-none', monospace && 'font-mono')}
      />
    </div>
  );
}

// ── SelectField ──────────────────────────────────────────────────────────

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SelectFieldProps<T extends string> {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function SelectField<T extends string>({ value, options, onChange, ariaLabel, disabled, className }: SelectFieldProps<T>) {
  return (
    <Select
      value={value}
      onValueChange={onChange}
      options={options}
      disabled={disabled}
      label={ariaLabel}
      className={cn('w-full', className)}
    />
  );
}

// ── ColorField ───────────────────────────────────────────────────────────

const HEX_RE = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export interface ColorFieldProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

export function ColorField({ value, onChange, ariaLabel, disabled }: ColorFieldProps) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const safe = HEX_RE.test(value) ? value : '#000000';
  const swatchColor = safe.slice(0, 7);
  const alpha = safe.length > 7 ? safe.slice(7) : '';

  return (
    <div className={cn(FIELD_BOX, disabled && 'opacity-50')}>
      <button
        type="button"
        aria-label={ariaLabel ?? 'Choose colour'}
        disabled={disabled}
        onClick={() => pickerRef.current?.click()}
        className="size-5 shrink-0 cursor-pointer rounded border border-primary"
        style={{ backgroundColor: swatchColor }}
      />
      <input
        ref={pickerRef}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        value={swatchColor}
        onChange={(event) => onChange(event.target.value + alpha)}
        className="sr-only"
      />
      <TextField value={safe.toUpperCase()} onCommit={(next) => onChange(HEX_RE.test(next) ? next : safe)} ariaLabel={ariaLabel ?? 'Hex colour'} monospace disabled={disabled} className="border-0 bg-transparent px-0" />
    </div>
  );
}

// ── SwitchField ──────────────────────────────────────────────────────────

export interface SwitchFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

export function SwitchField({ checked, onChange, ariaLabel, disabled }: SwitchFieldProps) {
  return <Switch checked={checked} onCheckedChange={onChange} label={ariaLabel} disabled={disabled} />;
}

// ── AutoGrowTextarea ─────────────────────────────────────────────────────

export interface AutoGrowTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  minRows?: number;
  autoFocus?: boolean;
}

export function AutoGrowTextarea({ value, onChange, onFocus, onBlur, onKeyDown, placeholder, ariaLabel, disabled, minRows = 2, autoFocus }: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className="w-full min-w-0 resize-none rounded-sm bg-tertiary px-2 py-1.5 text-primary outline-none transition-colors focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
