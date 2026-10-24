import { useState, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { cn } from './cn';
import { Field, useFieldIds, type FieldLabelPlacement } from './field';
import { Popover } from './popover';
import { TextField } from './text-field';

const HEX_RE = /^[0-9a-f]+$/;

/**
 * Single source of truth for hex parsing. Accepts an optional leading `#`, 3-
 * or 6-digit RGB and (when `allowAlpha`) 8-digit RGBA, case-insensitively.
 * Returns canonical lowercase `#rrggbb` / `#rrggbbaa`, or null if unparseable.
 */
export function normalizeHex(input: string, allowAlpha = true): string | null {
  const digits = input.trim().replace(/^#/, '').toLowerCase();
  if (!HEX_RE.test(digits)) return null;
  if (digits.length === 3) return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
  if (digits.length === 6) return `#${digits}`;
  if (digits.length === 8 && allowAlpha) return `#${digits}`;
  return null;
}

export interface ColorFieldProps {
  /** Hex, with or without alpha: `#RRGGBB` or `#RRGGBBAA`. */
  value: string;
  onValueChange: (value: string) => void;
  /** Preserve/accept the `AA` suffix. Default true. */
  allowAlpha?: boolean;
  /** Show the hex text input beside the swatch. Default true. */
  showInput?: boolean;
  /** Content rendered in a popover when the swatch is clicked. */
  picker?: ReactNode;
  size?: 'sm' | 'md';
  label?: string;
  labelPlacement?: FieldLabelPlacement;
  error?: string;
  hint?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

// Checkerboard from two gradients, coloured by border tokens so it follows the theme.
const CHECKER: CSSProperties = {
  backgroundImage:
    'conic-gradient(var(--border-color-primary) 25%, var(--border-color-secondary) 0 50%, var(--border-color-primary) 0 75%, var(--border-color-secondary) 0)',
  backgroundSize: '8px 8px',
};

export function ColorField({
  value,
  onValueChange,
  allowAlpha = true,
  showInput = true,
  picker,
  size = 'md',
  label,
  labelPlacement,
  error,
  hint,
  disabled,
  id,
  className,
}: ColorFieldProps): ReactElement {
  const ids = useFieldIds(id, { error, hint });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  // Bumped when an invalid draft is committed so TextField remounts and shows the last valid value.
  const [revision, setRevision] = useState(0);

  // Canonical incoming value; an unparseable one falls back to black. When alpha
  // is disallowed the suffix is dropped for display and emission.
  const parsed = normalizeHex(value, true) ?? '#000000';
  const current = allowAlpha ? parsed : parsed.slice(0, 7);
  const rgb = current.slice(0, 7);
  const alphaSuffix = current.length === 9 ? current.slice(7) : '';
  const alpha = alphaSuffix ? parseInt(alphaSuffix, 16) / 255 : 1;

  function commit(draft: string) {
    const next = normalizeHex(draft, allowAlpha);
    if (!next) {
      setRevision((n) => n + 1);
      return;
    }
    // Typed RGB only: keep the existing alpha. A typed 8-digit value wins.
    const merged = next.length === 7 ? next + alphaSuffix : next;
    if (merged !== current) onValueChange(merged);
    else setRevision((n) => n + 1);
  }

  const swatchSize = size === 'sm' ? 'size-3.5' : 'size-4';
  const swatchBase = cn('relative block shrink-0 overflow-hidden rounded-sm border border-primary', swatchSize);
  const fill = (
    <span aria-hidden="true" className="absolute inset-0" style={{ backgroundColor: rgb + (alphaSuffix || '') }} />
  );
  const name = `${label ?? 'Colour'} ${current}`;

  const swatch = picker ? (
    <button
      type="button"
      id={showInput ? undefined : ids.id}
      ref={setAnchor}
      aria-label={name}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      onClick={() => setOpen((o) => !o)}
      className={cn(swatchBase, 'cursor-pointer focus-visible:ring-1 focus-visible:ring-brand focus-visible:outline-none disabled:cursor-not-allowed')}
      style={alpha < 1 ? CHECKER : undefined}
    >
      {fill}
    </button>
  ) : (
    <span role="img" aria-label={name} className={swatchBase} style={alpha < 1 ? CHECKER : undefined}>
      {fill}
    </span>
  );

  const popover = picker ? (
    <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom-start" className="rounded-md border border-primary bg-secondary p-2 shadow-lg">
      {picker}
    </Popover>
  ) : null;

  if (showInput) {
    return (
      <>
        <TextField
          key={revision}
          value={current}
          onValueChange={commit}
          commitOn="blur"
          size={size}
          icon={swatch}
          label={label}
          labelPlacement={labelPlacement}
          error={error}
          hint={hint}
          disabled={disabled}
          selectOnFocus
          maxLength={allowAlpha ? 9 : 7}
          id={ids.id}
          className={className}
        />
        {popover}
      </>
    );
  }

  return (
    <>
      <Field label={label} labelPlacement={labelPlacement} htmlFor={ids.id} error={error} hint={hint} disabled={disabled} className={className}>
        <div className={cn('inline-flex', disabled && 'opacity-50')} aria-describedby={ids.describedBy}>
          {swatch}
        </div>
      </Field>
      {popover}
    </>
  );
}
