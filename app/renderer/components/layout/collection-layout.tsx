import { useCallback, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { ThumbnailGrid, VirtualizedThumbnailGrid } from './thumbnail-grid';
import type { ResourceDrawerViewMode } from '../../types/ui';
import { VirtualizedList } from './virtualized-list';
import { useBinScrollRoot } from './bin-shell';

interface BinPanelLayoutProps {
  children: ReactNode;
  gridItemSize: number;
  mode?: ResourceDrawerViewMode;
  listClassName?: string;
  virtualize?: boolean;
  listItemEstimate?: number;
  gridRowEstimate?: number;
  overscan?: number;
}

const DEFAULT_LIST_ITEM_ESTIMATE = 44;
const DEFAULT_GRID_ROW_ESTIMATE = 180;

export function BinPanelLayout({
  children,
  gridItemSize,
  mode = 'grid',
  listClassName = '',
  virtualize = false,
  listItemEstimate = DEFAULT_LIST_ITEM_ESTIMATE,
  gridRowEstimate = DEFAULT_GRID_ROW_ESTIMATE,
  overscan,
}: BinPanelLayoutProps) {
  const scrollRootRef = useBinScrollRoot();
  const getScrollElement = useCallback(() => scrollRootRef?.current ?? null, [scrollRootRef]);

  if (virtualize) {
    return mode === 'grid' ? (
      <VirtualizedThumbnailGrid
        columns={gridItemSize}
        getScrollElement={getScrollElement}
        estimateRowSize={gridRowEstimate}
        overscan={overscan}
        className="w-full"
      >
        {children}
      </VirtualizedThumbnailGrid>
    ) : (
      <VirtualizedList
        getScrollElement={getScrollElement}
        estimateSize={listItemEstimate}
        overscan={overscan}
        itemGap={2}
        className={cn('w-full', listClassName)}
      >
        {children}
      </VirtualizedList>
    );
  }

  return (
    <>
      {mode === 'grid' ? (
        <ThumbnailGrid columns={gridItemSize} className="w-full">
          {children}
        </ThumbnailGrid>
      ) : (
        <div className={cn('flex flex-col gap-0.5', listClassName)}>
          {children}
        </div>
      )}
    </>
  );
}
