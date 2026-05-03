import { Grid2x2, List, Search } from 'lucide-react';
import { GridSizeSlider } from '../../components/form/grid-size-slider';
import { SegmentedControl } from '../../components/controls/segmented-control';
import { cn } from '@renderer/utils/cn';
import type { ResourceDrawerViewMode } from '../../types/ui';
import { CollectionPicker } from './collection-picker';
import type { BinCollectionsApi } from './use-bin-collections';

interface BinFooterProps {
  collections: BinCollectionsApi;
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
  className?: string;
}

export function BinFooter(props: BinFooterProps) {
  const {
    collections,
    searchValue,
    onSearchChange,
    searchPlaceholder = 'Search collection…',
    viewMode,
    onViewModeChange,
    gridSize,
    gridSizeMin,
    gridSizeMax,
    gridSizeStep = 1,
    onGridSizeChange,
    showGridSlider = true,
    className,
  } = props;

  function handleViewModeChange(next: string | string[]) {
    if (Array.isArray(next)) return;
    if (next === 'grid' || next === 'list') onViewModeChange(next);
  }

  return (
    <div className={cn('flex shrink-0 items-center gap-1.5 border-t border-secondary bg-background-secondary px-1.5 py-1', className)}>
      <CollectionPicker api={collections} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded bg-tertiary px-1.5 py-1 focus-within:bg-tertiary/60">
        <Search size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
        <input
          type="text"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-primary outline-none placeholder:text-tertiary"
        />
      </div>
      {showGridSlider && viewMode === 'grid' ? (
        <GridSizeSlider
          value={gridSize}
          min={gridSizeMin}
          max={gridSizeMax}
          step={gridSizeStep}
          onChange={onGridSizeChange}
        />
      ) : null}
      <SegmentedControl value={viewMode} onValueChange={handleViewModeChange} aria-label="Bin view mode">
        <SegmentedControl.Icon value="grid" title="Grid view" aria-label="Grid view">
          <Grid2x2 size={14} strokeWidth={1.5} />
        </SegmentedControl.Icon>
        <SegmentedControl.Icon value="list" title="List view" aria-label="List view">
          <List size={14} strokeWidth={1.5} />
        </SegmentedControl.Icon>
      </SegmentedControl>
    </div>
  );
}
