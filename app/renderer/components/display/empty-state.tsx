import type { HTMLAttributes } from 'react';
import { cn } from '@renderer/utils/cn';

function Root({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center', className)} {...props} />
  );
}

function Icon({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('text-quaternary', className)} {...props} />
  );
}

function Title({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('max-w-[16rem] text-xs font-medium text-secondary', className)} {...props} />
  );
}

function Description({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('max-w-[16rem] text-xs text-tertiary', className)} {...props} />
  );
}

function Action({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mt-1 flex items-center gap-2', className)} {...props} />
  );
}

export const EmptyState = { Root, Icon, Title, Description, Action };
