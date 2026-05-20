import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { cv } from '@renderer/utils/cv';

export const selectableRowStyles = cv({
  base: 'flex h-7 w-full items-center gap-2 rounded px-1.5 text-left transition-colors',
  variants: {
    selected: {
      true: ['bg-active text-primary'],
      false: ['text-secondary hover:bg-tertiary/55'],
    },
  },
  defaultVariants: {
    selected: false,
  },
});

interface SelectableRowRootProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  children: ReactNode;
  className?: string;
  selected: boolean;
}

interface SelectableRowPartProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

const Root = forwardRef<HTMLButtonElement, SelectableRowRootProps>(function Root(
  { children, className, selected, ...buttonProps },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(selectableRowStyles({ selected }), className)}
      {...buttonProps}
    >
      {children}
    </button>
  );
});

function Leading({ children, className, ...rest }: SelectableRowPartProps) {
  return (
    <span className={cn('shrink-0 text-tertiary', className)} {...rest}>
      {children}
    </span>
  );
}

function Label({ children, className, ...rest }: SelectableRowPartProps) {
  return (
    <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', className)} {...rest}>
      {children}
    </span>
  );
}

function Trailing({ children, className, ...rest }: SelectableRowPartProps) {
  return (
    <span className={cn('ml-auto flex shrink-0 items-center gap-1', className)} {...rest}>
      {children}
    </span>
  );
}

export const SelectableRow = { Root, Leading, Label, Trailing };
