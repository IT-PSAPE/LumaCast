import { useCallback, useRef, useState } from 'react';
import type { Id } from '@lumacast/kernel';
import type { PlaylistRow } from '@lumacast/composition';
import { useNavigation } from '../../contexts/navigation-context';
import { SortableList, useSortableOrder, VIRTUALIZED_SORTABLE_MEASURING } from '../../components/layout/sortable-list';
import { EmptyState } from '../../components/display/empty-state';
import { hasItemDragData, readItemDragData } from '../../utils/item-drag';
import { DropIndicator } from './drop-indicator';
import { SeparatorRow } from './separator-row';
import { PlaylistItemRow } from './playlist-item-row';
import { VirtualizedList } from '../../components/layout/virtualized-list';

const PLAYLIST_ROW_ESTIMATE = 32;
const playlistRowId = (row: PlaylistRow) => row.id;

export function PlaylistRowList({
  rows: persistedRows,
  playlistId,
  getScrollElement,
}: {
  rows: PlaylistRow[];
  playlistId: Id;
  getScrollElement: () => HTMLElement | null;
}) {
  const { addItemToPlaylist, movePlaylistRow } = useNavigation();
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const virtualScrollToIndexRef = useRef<((index: number) => void) | null>(null);
  const scrollToIndex = useCallback((index: number) => {
    virtualScrollToIndexRef.current?.(index);
  }, []);

  // Separators are ordinary rows in the flat list (#219 decision D5), so a
  // reorder is one op for either kind and any drop index is legal — there is no
  // container to fall outside of.
  const commitReorder = useCallback(
    // Unguarded on purpose: useSortableOrder reverts on rejection.
    ({ id, toIndex }: { id: Id; toIndex: number }) => movePlaylistRow(id, toIndex),
    [movePlaylistRow],
  );

  const { items: rows, dnd } = useSortableOrder({
    items: persistedRows,
    getId: playlistRowId,
    commit: commitReorder,
    // An in-progress drag from the bin owns the pointer; reordering during it
    // would fight the insertion indicator for the same gesture.
    disabled: dropIndex !== null,
  });
  const activeRowIndex = dnd.activeId ? rows.findIndex((row) => row.id === dnd.activeId) : -1;
  const activeRow = activeRowIndex === -1 ? null : rows[activeRowIndex];

  // Container handlers (empty content, end-of-list gap) only seed an initial
  // dropIndex when nothing is set yet — they never overwrite a value a
  // row-level handler already chose. Without this, positioning the indicator
  // on a specific row would snap back to the end the moment the cursor
  // crossed a gap between rows.
  function handleContainerDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!hasItemDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropIndex((prev) => prev ?? rows.length);
  }

  function handleRowDragOver(index: number, event: React.DragEvent<HTMLElement>) {
    if (!hasItemDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    const bounds = event.currentTarget.getBoundingClientRect();
    const isAfter = event.clientY > bounds.top + bounds.height / 2;
    setDropIndex(isAfter ? index + 1 : index);
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDropIndex(null);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    if (!hasItemDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();

    const itemRef = readItemDragData(event.dataTransfer);
    const nextDropIndex = dropIndex ?? rows.length;
    setDropIndex(null);
    if (!itemRef) return;

    // addItemToPlaylist rejects when the item no longer exists (#214), which
    // a drop can race. mutatePatch has already reported the failure, so
    // absorb the rethrow here.
    void addItemToPlaylist(playlistId, itemRef, nextDropIndex).catch(() => undefined);
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid="playlist-row-drop-surface"
        className="h-full min-h-0 p-1"
        onDragOver={handleContainerDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
      >
        <EmptyState.Root>
          <EmptyState.Title>No items yet</EmptyState.Title>
          <EmptyState.Description>Drag an item from the bin to add it here.</EmptyState.Description>
        </EmptyState.Root>
      </div>
    );
  }

  return (
    <SortableList.Root
      {...dnd}
      measuring={VIRTUALIZED_SORTABLE_MEASURING}
      activeId={dnd.activeId}
      virtualizedKeyboard={{
        onMoveToIndex: dnd.onKeyboardMoveToIndex,
        scrollToIndex,
      }}
      dragOverlay={activeRow ? (
        activeRow.kind === 'separator'
          ? <SeparatorRow row={activeRow} onDragOver={() => undefined} onDrop={() => undefined} overlay />
          : <PlaylistItemRow row={activeRow} onDragOver={() => undefined} onDrop={() => undefined} overlay />
      ) : null}
    >
      <div
        data-testid="playlist-row-drop-surface"
        className="h-full min-h-0 w-full"
        onDragOver={handleContainerDragOver}
        onDrop={handleDrop}
        onDragLeave={handleDragLeave}
      >
        <VirtualizedList
          getScrollElement={getScrollElement}
          estimateSize={PLAYLIST_ROW_ESTIMATE}
          retainedIndexes={activeRowIndex === -1 ? [] : [activeRowIndex]}
          itemGap={2}
          scrollToIndexRef={virtualScrollToIndexRef}
          className="p-1"
        >
          {rows.map((row, index) => (
            <PlaylistRowSlot
              key={row.id}
              row={row}
              index={index}
              dropIndex={dropIndex}
              isLast={index === rows.length - 1}
              onDragOver={handleRowDragOver}
              onDrop={handleDrop}
            />
          ))}
        </VirtualizedList>
      </div>
    </SortableList.Root>
  );
}

function PlaylistRowSlot({
  row,
  index,
  dropIndex,
  isLast,
  onDragOver,
  onDrop,
}: {
  row: PlaylistRow;
  index: number;
  dropIndex: number | null;
  isLast: boolean;
  onDragOver: (index: number, event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}) {
  return (
    <>
      {dropIndex === index && <DropIndicator />}
      {row.kind === 'separator' ? (
        <SeparatorRow
          row={row}
          onDragOver={(event) => onDragOver(index, event)}
          onDrop={onDrop}
        />
      ) : (
        <PlaylistItemRow
          row={row}
          onDragOver={(event) => onDragOver(index, event)}
          onDrop={onDrop}
        />
      )}
      {isLast && dropIndex === index + 1 && <DropIndicator />}
    </>
  );
}
