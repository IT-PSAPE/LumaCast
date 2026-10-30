import { useCallback, useRef, useState } from 'react';
import type { Id } from '@lumacast/kernel';
import type { PlaylistRow } from '@lumacast/composition';
import { useNavigation } from '../../contexts/navigation-context';
import { SortableList, useSortableOrder, VIRTUALIZED_SORTABLE_MEASURING } from '../../components/layout/sortable-list';
import { commitSelectedReorder } from '@lumacast/selection';
import { EmptyState, useConfirm } from '@lumacast/ui';
import { hasItemDragData, readItemDragData } from '../../utils/item-drag';
import { DropIndicator } from './drop-indicator';
import { SeparatorRow } from './separator-row';
import { PlaylistItemRow } from './playlist-item-row';
import { VirtualizedList } from '../../components/layout/virtualized-list';
import { useMultiSelection, useMultiSelectionKeyHandler } from '@lumacast/selection';
import type { SortableOrderCommit } from '../../components/layout/sortable-list';
import type { PlaylistRowSelectionProps } from './row-selection-props';

const PLAYLIST_ROW_ESTIMATE = 32;
const playlistRowId = (row: PlaylistRow) => row.id;

function moveSelectionOnePosition(ids: Id[], selected: ReadonlySet<Id>, direction: 'up' | 'down'): Id[] {
  const next = ids.slice();
  if (direction === 'up') {
    for (let index = 1; index < next.length; index += 1) {
      if (selected.has(next[index]) && !selected.has(next[index - 1])) {
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
      }
    }
  } else {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selected.has(next[index]) && !selected.has(next[index + 1])) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
  }
  return next;
}

export function PlaylistRowList({
  rows: persistedRows,
  playlistId,
  getScrollElement,
}: {
  rows: PlaylistRow[];
  playlistId: Id;
  getScrollElement: () => HTMLElement | null;
}) {
  const { addItemToPlaylist, movePlaylistRow, removePlaylistRow } = useNavigation();
  const confirm = useConfirm();
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const virtualScrollToIndexRef = useRef<((index: number) => void) | null>(null);
  const scrollToIndex = useCallback((index: number) => {
    virtualScrollToIndexRef.current?.(index);
  }, []);
  const orderedRowIds = persistedRows.map(playlistRowId);
  const selection = useMultiSelection(orderedRowIds, `playlist-rows:${playlistId}`);
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  function getActionRows(clickedId: Id): PlaylistRow[] {
    const byId = new Map(persistedRows.map((row) => [row.id, row]));
    return selection.actionIds(clickedId).flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  function retainSelection(ids: readonly Id[]) {
    const pending = new Set(ids);
    const visible = orderedRowIds.filter((id) => pending.has(id));
    selection.clearSelection();
    visible.forEach((id, index) => selection.select(id, index === 0 ? {} : { ctrlKey: true }));
  }

  async function handleRemoveRows(targetRows: readonly PlaylistRow[]) {
    const ok = await confirm({
      title: `Remove ${targetRows.length} rows from playlist?`,
      description: 'Selected entries and separators will be removed from this playlist. The items themselves remain.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;

    for (let index = 0; index < targetRows.length; index += 1) {
      try {
        await removePlaylistRow(targetRows[index].id);
      } catch {
        retainSelection(targetRows.slice(index).map((row) => row.id));
        return;
      }
    }
    selection.clearSelection();
  }

  async function handleMoveRows(targetRows: readonly PlaylistRow[], direction: 'up' | 'down') {
    const beforeIds = rows.map(playlistRowId);
    const selectedIds = new Set(targetRows.map((row) => row.id));
    const orderedIds = moveSelectionOnePosition(beforeIds, selectedIds, direction);
    if (orderedIds.every((id, index) => id === beforeIds[index])) return;
    const targetIndexes = new Map(orderedIds.map((id, index) => [id, index]));
    const operationOrder = targetRows.map((row) => row.id).sort((left, right) => (targetIndexes.get(left) ?? 0) - (targetIndexes.get(right) ?? 0));
    if (direction === 'down') operationOrder.reverse();
    for (let index = 0; index < operationOrder.length; index += 1) {
      try {
        const id = operationOrder[index];
        await movePlaylistRow(id, targetIndexes.get(id) ?? 0);
      } catch {
        retainSelection(operationOrder.slice(index));
        return;
      }
    }
  }

  // Separators are ordinary rows in the flat list (#219 decision D5), so a
  // reorder is one op for either kind and any drop index is legal — there is no
  // container to fall outside of.
  const commitReorder = useCallback(
    // Unguarded on purpose: useSortableOrder reverts on rejection.
    (change: SortableOrderCommit) => commitSelectedReorder(change, movePlaylistRow),
    [movePlaylistRow],
  );

  const { items: rows, dnd } = useSortableOrder({
    items: persistedRows,
    getId: playlistRowId,
    commit: commitReorder,
    selectedIds: selection.selectedIds,
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
        data-shortcuts-scope="ignore"
        className="h-full min-h-0 w-full"
        onKeyDown={handleSelectionKeys}
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
              selectionProps={{
                isMultiSelected: selection.selectedIds.has(row.id),
                actionRows: getActionRows(row.id),
                onSelectionClick: (id, event) => {
                  selection.select(id, event);
                  return event.shiftKey || event.metaKey || event.ctrlKey;
                },
                onRemoveRows: handleRemoveRows,
                onMoveRows: handleMoveRows,
              }}
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
  selectionProps,
}: {
  row: PlaylistRow;
  index: number;
  dropIndex: number | null;
  isLast: boolean;
  onDragOver: (index: number, event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
  selectionProps: PlaylistRowSelectionProps;
}) {
  return (
    <>
      {dropIndex === index && <DropIndicator />}
      {row.kind === 'separator' ? (
        <SeparatorRow
          row={row}
          {...selectionProps}
          onDragOver={(event) => onDragOver(index, event)}
          onDrop={onDrop}
        />
      ) : (
        <PlaylistItemRow
          row={row}
          {...selectionProps}
          onDragOver={(event) => onDragOver(index, event)}
          onDrop={onDrop}
        />
      )}
      {isLast && dropIndex === index + 1 && <DropIndicator />}
    </>
  );
}
