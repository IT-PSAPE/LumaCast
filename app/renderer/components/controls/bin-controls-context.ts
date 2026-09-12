import { createContext, use } from 'react';
import type { ResourceDrawerViewMode } from '../../types/ui';

export interface BinGridConfig {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (size: number) => void;
}

export interface BinControlsContextValue {
  state: {
    searchValue: string;
    viewMode: ResourceDrawerViewMode;
    grid: BinGridConfig | null;
  };
  actions: {
    onSearchChange: (value: string) => void;
    onViewModeChange: (mode: ResourceDrawerViewMode) => void;
  };
  meta: {
    searchPlaceholder: string;
  };
}

export const BinControlsContext = createContext<BinControlsContextValue | null>(null);

export function useBinControls(): BinControlsContextValue {
  const context = use(BinControlsContext);
  if (!context) throw new Error('BinControls must be used within BinControlsProvider');
  return context;
}
