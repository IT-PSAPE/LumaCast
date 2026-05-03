import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import type { ResourceDrawerViewMode } from '../../types/ui';
import { BinFooter } from './bin-footer';
import type { BinCollectionsApi } from './use-bin-collections';

interface BinShellProps {
  collections: BinCollectionsApi;
  children: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  viewMode: ResourceDrawerViewMode;
  onViewModeChange: (mode: ResourceDrawerViewMode) => void;
  gridSize: number;
  gridSizeMin: number;
  gridSizeMax: number;
  gridSizeStep?: number;
  onGridSizeChange: (size: number) => void;
  showGridSlider?: boolean;
  contentClassName?: string;
  className?: string;
}

export function BinShell({
  collections,
  children,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  viewMode,
  onViewModeChange,
  gridSize,
  gridSizeMin,
  gridSizeMax,
  gridSizeStep,
  onGridSizeChange,
  showGridSlider,
  contentClassName,
  className,
}: BinShellProps) {
  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col', className)}>
      <div className={cn('flex-1 min-h-0 overflow-auto px-2 py-1.5', contentClassName)}>
        {children}
      </div>
      <BinFooter
        collections={collections}
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        gridSize={gridSize}
        gridSizeMin={gridSizeMin}
        gridSizeMax={gridSizeMax}
        gridSizeStep={gridSizeStep}
        onGridSizeChange={onGridSizeChange}
        showGridSlider={showGridSlider}
      />
    </div>
  );
}
