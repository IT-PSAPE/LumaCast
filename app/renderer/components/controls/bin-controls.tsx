import { createContext, use, useMemo, type ReactNode } from 'react';
import { Grid2x2, List, Search as SearchIcon } from 'lucide-react';
import { FieldIcon, FieldInput } from '../form/field';
import { InspectorSlider } from '../form/inspector-slider';
import { Dropdown } from '../form/dropdown';
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

interface BinControlsProviderProps {
  children: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  viewMode: ResourceDrawerViewMode;
  onViewModeChange: (mode: ResourceDrawerViewMode) => void;
  grid: BinGridConfig | null;
}

export function BinControlsProvider({
  children,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  viewMode,
  onViewModeChange,
  grid,
}: BinControlsProviderProps) {
  const value = useMemo(
    () => ({
      state: { searchValue, viewMode, grid },
      actions: { onSearchChange, onViewModeChange },
      meta: { searchPlaceholder },
    }),
    [grid, onSearchChange, onViewModeChange, searchPlaceholder, searchValue, viewMode],
  );

  return <BinControlsContext.Provider value={value}>{children}</BinControlsContext.Provider>;
}

export function BinControlsSearchField() {
  const { state, actions, meta } = useBinControls();
  return (
    <FieldInput
      value={state.searchValue}
      onChange={actions.onSearchChange}
      placeholder={meta.searchPlaceholder}
      ariaLabel="Search"
      wrapperClassName="h-6 min-h-6 px-1.5 focus-within:bg-tertiary/60"
      iconClassName="ml-0 mr-1.5 size-auto"
      inputClassName="p-0 placeholder:text-tertiary"
    >
      <FieldIcon>
        <SearchIcon size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
      </FieldIcon>
    </FieldInput>
  );
}

export function BinControlsViewOptions() {
  const { state, actions } = useBinControls();
  const grid = state.viewMode === 'grid' ? state.grid : null;

  // No leading separator: the host decides whether one is needed, since this
  // fragment is the whole menu in the program panel and an appended section in
  // the resource drawer.
  return (
    <>
      <Dropdown.Item onClick={() => actions.onViewModeChange('grid')}>
        <Grid2x2 size={14} strokeWidth={1.5} /> Grid
      </Dropdown.Item>
      <Dropdown.Item onClick={() => actions.onViewModeChange('list')}>
        <List size={14} strokeWidth={1.5} /> List
      </Dropdown.Item>
      {grid && (
        <>
          <Dropdown.Separator />
          <div className="px-1 py-1.5">
            <InspectorSlider
              value={grid.value}
              min={grid.min}
              max={grid.max}
              step={grid.step}
              onChange={grid.onChange}
              label="Size"
              ariaLabel="Grid size"
            />
          </div>
        </>
      )}
    </>
  );
}
