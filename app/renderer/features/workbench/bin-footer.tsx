import { createContext, use, type HTMLAttributes } from 'react';
import { Grid2x2, List, Search as SearchIcon } from 'lucide-react';
import { FieldIcon, FieldInput } from '../../components/form/field';
import { GridSizeSlider } from '../../components/form/grid-size-slider';
import { SegmentedControl } from '../../components/controls/segmented-control';
import { cn } from '@renderer/utils/cn';
import type { ResourceDrawerViewMode } from '../../types/ui';

export interface BinGridConfig {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (size: number) => void;
}

export interface BinShellContextValue {
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

export const BinShellContext = createContext<BinShellContextValue | null>(null);

function useBinShellContext() {
  const context = use(BinShellContext);
  if (!context) throw new Error('BinShell pieces must be rendered within BinShell');
  return context;
}

export function Footer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex shrink-0 items-center gap-1.5 border-t border-secondary bg-background-secondary px-1.5 py-1', className)}
      {...props}
    />
  );
}

export function Search() {
  const { state, actions, meta } = useBinShellContext();

  return (
    <div className="min-w-0 flex-1">
      <FieldInput
        value={state.searchValue}
        onChange={actions.onSearchChange}
        placeholder={meta.searchPlaceholder}
        ariaLabel="Search"
        wrapperClassName="h-7 min-h-7 px-1.5 focus-within:bg-tertiary/60"
        iconClassName="ml-0 mr-1.5 size-auto"
        inputClassName="p-0 placeholder:text-tertiary"
      >
        <FieldIcon><SearchIcon size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" /></FieldIcon>
      </FieldInput>
    </div>
  );
}

export function ViewToggle() {
  const { state, actions } = useBinShellContext();

  function handleViewModeChange(next: string | string[]) {
    if (Array.isArray(next)) return;
    if (next === 'grid' || next === 'list') actions.onViewModeChange(next);
  }

  return (
    <SegmentedControl value={state.viewMode} onValueChange={handleViewModeChange} aria-label="Bin view mode">
      <SegmentedControl.Icon value="grid" title="Grid view" aria-label="Grid view">
        <Grid2x2 size={14} strokeWidth={1.5} />
      </SegmentedControl.Icon>
      <SegmentedControl.Icon value="list" title="List view" aria-label="List view">
        <List size={14} strokeWidth={1.5} />
      </SegmentedControl.Icon>
    </SegmentedControl>
  );
}

export function GridSize() {
  const { state } = useBinShellContext();
  if (state.grid === null || state.viewMode !== 'grid') return null;

  return (
    <GridSizeSlider
      value={state.grid.value}
      min={state.grid.min}
      max={state.grid.max}
      step={state.grid.step}
      onChange={state.grid.onChange}
    />
  );
}
