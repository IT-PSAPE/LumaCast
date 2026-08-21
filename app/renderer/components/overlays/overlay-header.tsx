import { cn } from '@renderer/utils/cn';
import { type HTMLAttributes } from 'react';

export function OverlayHeader({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center gap-2 border-b border-primary p-3', className)} {...props}>
      {children}
    </div>
  );
}
