import { cn } from '@renderer/utils/cn';
import { type HTMLAttributes } from 'react';

export function OverlayFooter({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex items-center gap-2 border-t border-primary p-3', className)} {...props}>
      {children}
    </div>
  );
}
