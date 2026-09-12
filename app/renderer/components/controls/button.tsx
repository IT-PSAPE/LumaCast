import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Button } from '@base-ui/react/button';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

export type ButtonVariant = 'default' | 'take' | 'danger' | 'ghost';

// Disabled styling keys off Base UI's `data-disabled` attribute (present
// whenever `disabled` is true) instead of a bespoke variant, per the app's
// convention of styling Base UI state through its data attributes.
const buttonVariants = cv({
  base: 'cursor-pointer transition-colors px-3 py-1.5 rounded-sm text-center label-xs data-disabled:cursor-not-allowed data-disabled:pointer-events-none data-disabled:opacity-50',
  variants: {
    variant: {
      default: 'bg-tertiary text-primary hover:bg-brand/10',
      take: 'bg-success/15 text-primary hover:bg-success/25',
      danger: 'bg-error/15 text-primary hover:bg-error/25',
      ghost: 'bg-transparent text-secondary hover:bg-tertiary hover:text-primary',
    },
    active: {
      true: null,
      false: null,
    },
  },
  defaultVariants: {
    variant: 'default',
    active: false,
  },
  compoundVariants: [
    { variant: 'default', active: true, className: 'bg-tertiary text-primary' },
    { variant: 'take', active: true, className: 'bg-success/15 text-primary' },
    { variant: 'danger', active: true, className: 'bg-error/15 text-primary' },
    { variant: 'ghost', active: true, className: 'bg-tertiary text-primary' },
  ],
});

const iconButtonVariants = cv({
  base: 'cursor-pointer transition-colors p-1.5 rounded-sm *:size-4 data-disabled:cursor-not-allowed data-disabled:pointer-events-none data-disabled:opacity-50',
  variants: {
    variant: {
      default: 'bg-tertiary text-primary hover:bg-brand/10',
      take: 'bg-success/15 text-primary hover:bg-success/25',
      danger: 'bg-error/15 text-primary hover:bg-error/25',
      ghost: 'bg-transparent text-tertiary hover:bg-tertiary hover:text-primary',
    },
    active: {
      true: null,
      false: null,
    },
  },
  defaultVariants: {
    variant: 'default',
    active: false,
  },
  compoundVariants: [
    { variant: 'default', active: true, className: 'bg-tertiary text-primary' },
    { variant: 'take', active: true, className: 'bg-success/15 text-primary' },
    { variant: 'danger', active: true, className: 'bg-error/15 text-primary' },
    { variant: 'ghost', active: true, className: 'bg-tertiary text-primary' },
  ],
});

interface ButtonRootProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {
  active?: boolean;
  children: ReactNode;
  className?: string;
  label?: string;
  variant?: ButtonVariant;
}

function Root({ active = false, children, className, disabled = false, label, type = 'button', variant = 'default', ...buttonProps }: ButtonRootProps) {
  return (
    <Button
      type={type}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...buttonProps}
      className={cn(buttonVariants({ active, variant }), className)}
    >
      {children}
    </Button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {
  active?: boolean;
  children: ReactNode;
  className?: string;
  label?: string;
  variant?: ButtonVariant;
}

function Icon({ active = false, children, className, disabled = false, label, type = 'button', variant = 'default', ...buttonProps }: IconButtonProps) {
  return (
    <Button
      type={type}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...buttonProps}
      className={cn(iconButtonVariants({ active, variant }), className)}
    >
      {children}
    </Button>
  );
}

export const ReacstButton = Object.assign(Root, {
  Icon,
});
