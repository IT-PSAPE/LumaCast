import { cn } from '@renderer/utils/cn';
import { type HTMLAttributes } from 'react';

export function OverlayContent({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-1 flex-col overflow-y-auto', className)} {...props}>
      {children}
    </div>
  );
}
