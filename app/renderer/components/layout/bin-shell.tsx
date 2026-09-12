import { createContext, useContext, useRef, type HTMLAttributes, type MutableRefObject, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';

interface BinShellProps {
  children: ReactNode;
  className?: string;
}

const BinScrollRootContext = createContext<MutableRefObject<HTMLDivElement | null> | null>(null);

export function useBinScrollRoot() {
  return useContext(BinScrollRootContext);
}

function Root({ children, className }: BinShellProps) {
  return <div className={cn('flex h-full min-h-0 w-full flex-col', className)}>{children}</div>;
}

function Content({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const scrollRootRef = useRef<HTMLDivElement | null>(null);

  return (
    <BinScrollRootContext.Provider value={scrollRootRef}>
      <div
        ref={(node) => {
          scrollRootRef.current = node;
        }}
        className={cn('flex-1 min-h-0 overflow-auto px-2 py-1.5', className)}
        {...props}
      />
    </BinScrollRootContext.Provider>
  );
}

export const BinShell = Object.assign(Root, { Content });
export type { BinGridConfig } from '../controls/bin-controls';
