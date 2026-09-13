import { useMemo, type ReactNode } from 'react';
import { BinControlsContext, type BinGridConfig } from './bin-controls-context';
import type { ResourceDrawerViewMode } from '../../types/ui';

interface BinControlsProviderProps {
  children: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  viewMode: ResourceDrawerViewMode;
  onViewModeChange: (mode: ResourceDrawerViewMode) => void;
  grid: BinGridConfig | null;
}

export function BinControlsProvider({
  children,
  searchValue,
  onSearchChange,
  viewMode,
  onViewModeChange,
  grid,
}: BinControlsProviderProps) {
  const value = useMemo(
    () => ({
      state: { searchValue, viewMode, grid },
      actions: { onSearchChange, onViewModeChange },
    }),
    [grid, onSearchChange, onViewModeChange, searchValue, viewMode],
  );

  return <BinControlsContext.Provider value={value}>{children}</BinControlsContext.Provider>;
}
