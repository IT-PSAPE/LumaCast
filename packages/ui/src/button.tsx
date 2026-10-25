import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Button } from '@base-ui/react/button';
import { cn } from './cn';
import { cv } from './cv';
import { Tooltip } from './tooltip';

export type ButtonVariant = 'default' | 'take' | 'danger' | 'ghost' | 'primary' | 'tinted' | 'outline' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type ButtonShape = 'rounded' | 'pill';

// One variant matrix drives both `ReacstButton` and `ReacstButton.Icon`. The
// `kind` axis ('text' | 'icon') selects the geometry; variant colours, the
// pressed/active state and fullWidth/align are shared.
//
// Disabled styling keys off Base UI's `data-disabled` attribute (present
// whenever `disabled` is true). `loading` also sets `disabled` so it cannot be
// activated, and `data-loading` restores full opacity for that case.
//
// Heights (px). Text: xs 22, sm 24, md ~25 (legacy: py-1.5 + 12px label, FROZEN),
// lg 28, xl 34. Icon (square): xs 20, sm 24, md 28 (legacy: p-1.5 + 16px glyph),
// lg 28, xl 32.
// Non-md sizes use explicit heights so they are exact; md keeps its padding
// metrics unchanged so existing call sites do not shift.
const buttonVariants = cv({
  base: 'relative cursor-pointer transition-colors rounded-sm data-disabled:cursor-not-allowed data-disabled:pointer-events-none data-disabled:opacity-50 data-loading:data-disabled:opacity-100',
  variants: {
    kind: {
      text: 'inline-flex items-center gap-1.5 whitespace-nowrap',
      icon: '',
    },
    variant: {
      default: 'bg-tertiary text-primary hover:bg-brand/10',
      take: 'bg-success/15 text-primary hover:bg-success/25',
      danger: 'bg-error/15 text-primary hover:bg-error/25',
      ghost: 'bg-transparent hover:bg-tertiary hover:text-primary',
      primary: 'bg-brand text-white hover:bg-brand/90',
      tinted: 'bg-brand/15 text-brand hover:bg-brand/25',
      outline: 'bg-transparent text-primary shadow-[inset_0_0_0_1px_var(--border-color-primary)] hover:bg-tertiary',
      link: 'bg-transparent text-brand hover:underline',
    },
    size: {
      xs: null,
      sm: null,
      md: null,
      lg: null,
      xl: null,
    },
    // Public corner shape (Badge vocabulary). `rounded` is the base radius.
    shape: {
      rounded: null,
      pill: 'rounded-full',
    },
    // `on` is the visual pressed/active state (set from `pressed || active`).
    on: {
      true: null,
      false: null,
    },
    fullWidth: {
      true: 'flex w-full',
      false: null,
    },
    align: {
      center: 'justify-center',
      start: 'justify-start text-left',
    },
    iconPosition: {
      leading: null,
      trailing: 'flex-row-reverse',
    },
  },
  defaultVariants: {
    kind: 'text',
    shape: 'rounded',
    variant: 'default',
    size: 'md',
    on: false,
    fullWidth: false,
    align: 'center',
    iconPosition: 'leading',
  },
  compoundVariants: [
    // Text geometry.
    { kind: 'text', size: 'xs', className: 'h-[22px] px-2 label-xs' },
    { kind: 'text', size: 'sm', className: 'h-6 px-2.5 label-xs' },
    { kind: 'text', size: 'md', className: 'px-3 py-1.5 label-xs' },
    { kind: 'text', size: 'lg', className: 'h-7 px-3.5 label-xs' },
    { kind: 'text', size: 'xl', className: 'h-[34px] px-4 label-sm' },
    // Icon geometry. Non-md sizes centre explicitly; md keeps legacy padding.
    { kind: 'icon', size: 'xs', className: 'inline-flex size-5 items-center justify-center *:size-3' },
    { kind: 'icon', size: 'sm', className: 'inline-flex size-6 items-center justify-center *:size-3.5' },
    { kind: 'icon', size: 'md', className: 'p-1.5 *:size-4' },
    { kind: 'icon', size: 'lg', className: 'inline-flex size-7 items-center justify-center *:size-4' },
    { kind: 'icon', size: 'xl', className: 'inline-flex size-8 items-center justify-center *:size-[18px]' },
    // Resting text colour: icon ghost is tertiary, text ghost is secondary.
    { kind: 'text', variant: 'ghost', className: 'text-secondary' },
    { kind: 'icon', variant: 'ghost', className: 'text-tertiary' },
    // Pressed / active.
    { variant: 'default', on: true, className: 'bg-tertiary text-primary' },
    { variant: 'take', on: true, className: 'bg-success/15 text-primary' },
    { variant: 'danger', on: true, className: 'bg-error/15 text-primary' },
    { variant: 'ghost', on: true, className: 'bg-tertiary text-primary' },
    { variant: 'primary', on: true, className: 'bg-brand' },
    { variant: 'tinted', on: true, className: 'bg-brand/25' },
    { variant: 'outline', on: true, className: 'bg-tertiary' },
    { variant: 'link', on: true, className: 'underline' },
    // Link has no padding box in any size or shape.
    { variant: 'link', className: 'size-auto h-auto min-h-0 p-0 rounded-none' },
  ],
});

interface ButtonSharedProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {
  /**
   * Visual pressed state (background only; emits no ARIA). Kept for existing
   * call sites. Prefer `pressed`, which also sets `aria-pressed`.
   */
  active?: boolean;
  /** `start` left-aligns content (nav / list rows); default is `center`. */
  align?: 'center' | 'start';
  children: ReactNode;
  className?: string;
  /** Forwarded to the underlying `<button>` (React 19 ref prop). */
  ref?: Ref<HTMLButtonElement>;
  /** Corner shape. `pill` is fully rounded. Default `rounded`. */
  shape?: ButtonShape;
  fullWidth?: boolean;
  /** Order of icon vs label when children are `[icon, label]`. Default `leading`. */
  iconPosition?: 'leading' | 'trailing';
  /** Accessible name (`aria-label`); also the native `title` unless `tooltip` is set. */
  label?: string;
  /** Shows a spinner and blocks activation. The width of the button is preserved. */
  loading?: boolean;
  /** Toggle state. Sets `aria-pressed` and the pressed styling. Preferred over `active`. */
  pressed?: boolean;
  /** Size scale. `md` (default) is the legacy metric. */
  size?: ButtonSize;
  /** Wraps the button in a `Tooltip`. Nothing is wrapped when absent. */
  tooltip?: string;
  variant?: ButtonVariant;
}

export type ButtonRootProps = ButtonSharedProps;
export type IconButtonProps = ButtonSharedProps;

function Spinner() {
  return (
    <span data-spinner="" aria-hidden="true" className="absolute inset-0 m-auto size-3.5">
      <svg className="size-full animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
        <circle cx="12" cy="12" r="9" opacity={0.25} />
        <path d="M21 12a9 9 0 0 0-9-9" />
      </svg>
    </span>
  );
}

function renderButton(
  kind: 'text' | 'icon',
  {
    active = false,
    align = 'center',
    children,
    className,
    disabled = false,
    fullWidth = false,
    iconPosition = 'leading',
    label,
    loading = false,
    pressed,
    ref,
    shape = 'rounded',
    size = 'md',
    tooltip,
    type = 'button',
    variant = 'default',
    ...buttonProps
  }: ButtonSharedProps,
) {
  const button = (
    <Button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-label={label}
      title={tooltip ? undefined : label}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      data-loading={loading ? '' : undefined}
      {...buttonProps}
      className={cn(
        buttonVariants({ kind, shape, variant, size, on: active || pressed === true, fullWidth, align, iconPosition }),
        loading && kind === 'icon' && '[&>:not([data-spinner])]:invisible',
        className,
      )}
    >
      {loading && kind === 'text' ? <span className="invisible contents">{children}</span> : children}
      {loading ? <Spinner /> : null}
    </Button>
  );

  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
}

function Root(props: ButtonRootProps) {
  return renderButton('text', props);
}

function Icon(props: IconButtonProps) {
  return renderButton('icon', props);
}

export const ReacstButton = Object.assign(Root, {
  Icon,
});
