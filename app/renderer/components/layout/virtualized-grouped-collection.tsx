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
}

type GroupedRowDescriptor<T> =
  | { kind: 'header'; key: string; estimate: number; section: GroupedVirtualizedCollectionSection<T> }
  | { kind: 'empty'; key: string; estimate: number; section: GroupedVirtualizedCollectionSection<T> }
  | { kind: 'grid'; key: string; estimate: number; section: GroupedVirtualizedCollectionSection<T>; startIndex: number; lastChunk: boolean }
  | { kind: 'list'; key: string; estimate: number; section: GroupedVirtualizedCollectionSection<T>; item: T; index: number; last: boolean };

interface GroupedVirtualizedCollectionProps<T> {
  sections: GroupedVirtualizedCollectionSection<T>[];
  mode?: ResourceDrawerViewMode;
  gridItemSize: number;
  renderListItem: (item: T, index: number, section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
  renderGridItem: (item: T, index: number, section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
  renderEmptyState: (section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
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

function GroupedCollectionHeader<T>({ section }: { section: GroupedVirtualizedCollectionSection<T> }) {
  return (
    <div className="pb-1.5">
      <Label.xs className="px-1 text-tertiary">{section.label}</Label.xs>
    </div>
  );
}

function GroupedCollectionEmpty<T>({ section, renderEmptyState }: {
  section: GroupedVirtualizedCollectionSection<T>;
  renderEmptyState: (section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
}) {
  return <div className="pb-3">{renderEmptyState(section)}</div>;
}

function GroupedCollectionGridRow<T>({ section, startIndex, gridItemSize, lastChunk, renderGridItem }: {
  section: GroupedVirtualizedCollectionSection<T>;
  startIndex: number;
  gridItemSize: number;
  lastChunk: boolean;
  renderGridItem: (item: T, index: number, section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
}) {
  return (
    <div className={lastChunk ? 'pb-3' : 'pb-1.5'}>
      <ThumbnailGrid columns={gridItemSize} className="w-full">
        {section.items.slice(startIndex, startIndex + gridItemSize).map((item, chunkIndex) => renderGridItem(item, startIndex + chunkIndex, section))}
      </ThumbnailGrid>
    </div>
  );
}

function GroupedCollectionListRow<T>({ section, item, index, last, renderListItem }: {
  section: GroupedVirtualizedCollectionSection<T>;
  item: T;
  index: number;
  last: boolean;
  renderListItem: (item: T, index: number, section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
}) {
  return <div className={last ? 'pb-3' : 'pb-0.5'}>{renderListItem(item, index, section)}</div>;
}

function GroupedCollectionRow<T>({ row, gridItemSize, renderListItem, renderGridItem, renderEmptyState }: {
  row: GroupedRowDescriptor<T>;
  gridItemSize: number;
  renderListItem: (item: T, index: number, section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
  renderGridItem: (item: T, index: number, section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
  renderEmptyState: (section: GroupedVirtualizedCollectionSection<T>) => ReactNode;
}) {
  switch (row.kind) {
    case 'header':
      return <GroupedCollectionHeader section={row.section} />;
    case 'empty':
      return <GroupedCollectionEmpty section={row.section} renderEmptyState={renderEmptyState} />;
    case 'grid':
      return <GroupedCollectionGridRow section={row.section} startIndex={row.startIndex} gridItemSize={gridItemSize} lastChunk={row.lastChunk} renderGridItem={renderGridItem} />;
    case 'list':
      return <GroupedCollectionListRow section={row.section} item={row.item} index={row.index} last={row.last} renderListItem={renderListItem} />;
  }

  return assertNever(row);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported grouped collection row: ${JSON.stringify(value)}`);
}

export function GroupedVirtualizedCollection<T>({
  sections,
  mode = 'grid',
  gridItemSize,
  renderListItem,
  renderGridItem,
  renderEmptyState,
  getItemKey,
  headerEstimate = DEFAULT_HEADER_ESTIMATE,
  listItemEstimate = DEFAULT_LIST_ITEM_ESTIMATE,
  gridRowEstimate = DEFAULT_GRID_ROW_ESTIMATE,
  emptyEstimate = DEFAULT_EMPTY_ESTIMATE,
  overscan,
}: GroupedVirtualizedCollectionProps<T>) {
  const scrollRootRef = useBinScrollRoot();
  const getScrollElement = useCallback(() => scrollRootRef?.current ?? null, [scrollRootRef]);

  const rows = useMemo<GroupedRowDescriptor<T>[]>(() => {
    const result: GroupedRowDescriptor<T>[] = [];

    for (const section of sections) {
      result.push({ kind: 'header', key: `${section.key}-header`, estimate: headerEstimate, section });

      if (section.items.length === 0) {
        result.push({ kind: 'empty', key: `${section.key}-empty`, estimate: emptyEstimate, section });
        continue;
      }

      if (mode === 'grid') {
        for (let index = 0; index < section.items.length; index += gridItemSize) {
          result.push({
            kind: 'grid',
            key: `${section.key}-grid-${index}`,
            estimate: gridRowEstimate,
            section,
            startIndex: index,
            lastChunk: index + gridItemSize >= section.items.length,
          });
        }
        continue;
      }

      section.items.forEach((item, index) => {
        result.push({
          kind: 'list',
          key: `${section.key}-${String(getItemKey(item, section))}`,
          estimate: listItemEstimate,
          section,
          item,
          index,
          last: index === section.items.length - 1,
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
    sections,
  ]);

  return (
    <VirtualizedList
      getScrollElement={getScrollElement}
      estimateSize={(index) => rows[index]?.estimate ?? listItemEstimate}
      overscan={overscan}
      className="w-full"
    >
      {rows.map((row) => (
        <Fragment key={row.key}>
          <GroupedCollectionRow row={row} gridItemSize={gridItemSize} renderListItem={renderListItem} renderGridItem={renderGridItem} renderEmptyState={renderEmptyState} />
        </Fragment>
      ))}
    </VirtualizedList>
  );
}
