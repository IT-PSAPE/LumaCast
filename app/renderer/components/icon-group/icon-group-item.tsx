import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

const iconGroupItemStyles = cv({
  base: 'flex min-h-7 flex-1 items-center justify-center bg-tertiary px-2 text-secondary transition-colors hover:bg-tertiary hover:text-primary disabled:pointer-events-none disabled:opacity-50',
  variants: {
    active: {
      true: ['text-brand hover:text-brand'],
      false: [],
    },
  },
  defaultVariants: {
    active: false,
  },
});

interface IconGroupItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  active?: boolean;
}

export function IconGroupItem({ children, className, active = false, disabled = false, type = 'button', ...buttonProps }: IconGroupItemProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      {...buttonProps}
      className={cn(iconGroupItemStyles({ active }), className)}
    >
      {children}
    </button>
  );
}
