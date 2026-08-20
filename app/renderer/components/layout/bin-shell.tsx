import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';

interface BinShellProps {
  children: ReactNode;
  className?: string;
}

function Root({ children, className }: BinShellProps) {
  return <div className={cn('flex h-full min-h-0 w-full flex-col', className)}>{children}</div>;
}

function Content({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex-1 min-h-0 overflow-auto px-2 py-1.5', className)} {...props} />;
}

export const BinShell = Object.assign(Root, { Content });
export type { BinGridConfig } from '../controls/bin-controls';
