import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

export type ButtonVariant = 'default' | 'take' | 'danger' | 'ghost';

const buttonVariants = cv({
  base: 'cursor-pointer transition-colors px-3 py-1.5 rounded-sm text-center label-xs',
  variants: {
    variant: {
      default: 'bg-tertiary text-primary hover:border-brand hover:text-primary',
      take: 'bg-success/15 text-primary',
      danger: 'bg-error/15 text-primary',
      ghost: 'bg-transparent text-secondary hover:bg-tertiary hover:text-primary',
    },
    disabled: {
      true: 'opacity-50 cursor-not-allowed pointer-events-none',
      false: null,
    },
    active: {
      true: null,
      false: null,
    },
  },
  defaultVariants: {
    variant: 'default',
    disabled: false,
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
  base: 'cursor-pointer transition-colors p-1.5 rounded-sm *:size-4',
  variants: {
    variant: {
      default: 'bg-tertiary text-primary hover:border-brand hover:text-primary',
      take: 'bg-success/15 text-primary',
      danger: 'bg-error/15 text-primary',
      ghost: 'bg-transparent text-tertiary hover:bg-tertiary hover:text-primary',
    },
    disabled: {
      true: 'opacity-50 cursor-not-allowed pointer-events-none',
      false: null,
    },
    active: {
      true: null,
      false: null,
    },
  },
  defaultVariants: {
    variant: 'default',
    disabled: false,
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
    <button
      type={type}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...buttonProps}
      className={cn(buttonVariants({ active, disabled, variant }), className)}
    >
      {children}
    </button>
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
    <button
      type={type}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...buttonProps}
      className={cn(iconButtonVariants({ active, disabled, variant }), className)}
    >
      {children}
    </button>
  );
}

export const ReacstButton = Object.assign(Root, {
  Icon,
});
