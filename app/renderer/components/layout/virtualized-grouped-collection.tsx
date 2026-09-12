import { Fragment, useCallback, useMemo, type Key, type ReactNode } from 'react';
import { Label } from '@renderer/components/display/text';
import type { ResourceDrawerViewMode } from '../../types/ui';
import { useBinScrollRoot } from './bin-shell';
import { ThumbnailGrid } from './thumbnail-grid';
import { VirtualizedList } from './virtualized-list';

export interface GroupedVirtualizedCollectionSection<T> {
  key: string;
  label: string;
  items: T[];
  emptyState: ReactNode;
}

interface GroupedVirtualizedCollectionRow {
  key: Key;
  estimate: number;
  node: ReactNode;
}

interface GroupedVirtualizedCollectionProps<T> {
  sections: GroupedVirtualizedCollectionSection<T>[];
  mode?: ResourceDrawerViewMode;
  gridItemSize: number;
  renderListItem: (item: T, index: number, section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
  renderGridItem: (item: T, index: number, section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
  getItemKey: (item: T, section: GroupedVirtualizedCollectionSection<T>) => Key;
  headerEstimate?: number;
  listItemEstimate?: number;
  gridRowEstimate?: number;
  emptyEstimate?: number;
  overscan?: number;
}

const DEFAULT_HEADER_ESTIMATE = 28;
const DEFAULT_LIST_ITEM_ESTIMATE = 44;
const DEFAULT_GRID_ROW_ESTIMATE = 180;
const DEFAULT_EMPTY_ESTIMATE = 72;

export function GroupedVirtualizedCollection<T>({
  sections,
  mode = 'grid',
  gridItemSize,
  renderListItem,
  renderGridItem,
  getItemKey,
  headerEstimate = DEFAULT_HEADER_ESTIMATE,
  listItemEstimate = DEFAULT_LIST_ITEM_ESTIMATE,
  gridRowEstimate = DEFAULT_GRID_ROW_ESTIMATE,
  emptyEstimate = DEFAULT_EMPTY_ESTIMATE,
  overscan,
}: GroupedVirtualizedCollectionProps<T>) {
  const scrollRootRef = useBinScrollRoot();
  const getScrollElement = useCallback(() => scrollRootRef?.current ?? null, [scrollRootRef]);

  const rows = useMemo<GroupedVirtualizedCollectionRow[]>(() => {
    const result: GroupedVirtualizedCollectionRow[] = [];

    for (const section of sections) {
      result.push({
        key: `${section.key}-header`,
        estimate: headerEstimate,
        node: (
          <div className="pb-1.5">
            <Label.xs className="px-1 text-tertiary">{section.label}</Label.xs>
          </div>
        ),
      });

      if (section.items.length === 0) {
        result.push({
          key: `${section.key}-empty`,
          estimate: emptyEstimate,
          node: <div className="pb-3">{section.emptyState}</div>,
        });
        continue;
      }

      if (mode === 'grid') {
        for (let index = 0; index < section.items.length; index += gridItemSize) {
          const chunk = section.items.slice(index, index + gridItemSize);
          const isLastChunk = index + gridItemSize >= section.items.length;
          result.push({
            key: `${section.key}-grid-${index}`,
            estimate: gridRowEstimate,
            node: (
              <div className={isLastChunk ? 'pb-3' : 'pb-1.5'}>
                <ThumbnailGrid columns={gridItemSize} className="w-full">
                  {chunk.map((item, chunkIndex) => renderGridItem(item, index + chunkIndex, section))}
                </ThumbnailGrid>
              </div>
            ),
          });
        }
        continue;
      }

      section.items.forEach((item, index) => {
        const isLast = index === section.items.length - 1;
        result.push({
          key: `${section.key}-${String(getItemKey(item, section))}`,
          estimate: listItemEstimate,
          node: <div className={isLast ? 'pb-3' : 'pb-0.5'}>{renderListItem(item, index, section)}</div>,
        });
      });
    }

    return result;
  }, [
    emptyEstimate,
    getItemKey,
    gridItemSize,
    gridRowEstimate,
    headerEstimate,
    listItemEstimate,
    mode,
    renderGridItem,
    renderListItem,
    sections,
  ]);

  return (
    <VirtualizedList
      getScrollElement={getScrollElement}
      estimateSize={(index) => rows[index]?.estimate ?? listItemEstimate}
      overscan={overscan}
      className="w-full"
    >
      {rows.map((row) => <Fragment key={row.key}>{row.node}</Fragment>)}
    </VirtualizedList>
  );
}
