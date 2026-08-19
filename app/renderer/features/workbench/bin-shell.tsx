import { useMemo, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import type { ResourceDrawerViewMode } from '../../types/ui';
import { BinShellContext, Footer, GridSize, Search, ViewToggle, type BinGridConfig } from './bin-footer';

interface BinShellProps {
  children: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  viewMode: ResourceDrawerViewMode;
  onViewModeChange: (mode: ResourceDrawerViewMode) => void;
  grid?: BinGridConfig | null;
  className?: string;
}

function Root({
  children,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  viewMode,
  onViewModeChange,
  grid = null,
  className,
}: BinShellProps) {
  const value = useMemo(
    () => ({
      state: { searchValue, viewMode, grid },
      actions: { onSearchChange, onViewModeChange },
      meta: { searchPlaceholder },
    }),
    [grid, onSearchChange, onViewModeChange, searchPlaceholder, searchValue, viewMode],
  );

  return (
    <BinShellContext.Provider value={value}>
      <div className={cn('flex h-full min-h-0 w-full flex-col', className)}>
        {children}
      </div>
    </BinShellContext.Provider>
  );
}

function Content({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex-1 min-h-0 overflow-auto px-2 py-1.5', className)} {...props} />
  );
}

export const BinShell = Object.assign(Root, { Content, Footer, Search, ViewToggle, GridSize });
export type { BinGridConfig };
