import { useCallback, useState, type ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import type { PlaylistRow } from '@lumacast/composition';
import { useNavigation } from '../../contexts/navigation-context';
import { SortableList, useSortableOrder } from '../../components/layout/sortable-list';
import { EmptyState } from '../../components/display/empty-state';
import { hasItemDragData, readItemDragData } from '../../utils/item-drag';
import { DropIndicator } from './drop-indicator';
import { SeparatorRow } from './separator-row';
import { PlaylistItemRow } from './playlist-item-row';

const playlistRowId = (row: PlaylistRow) => row.id;

export function PlaylistRowList({ rows: persistedRows, playlistId }: { rows: PlaylistRow[]; playlistId: Id }) {
  const { addItemToPlaylist, movePlaylistRow } = useNavigation();
  const [dropIndex, setDropIndex] = useState<number | null>(null);

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
      <div className="p-1" onDragOver={handleContainerDragOver} onDrop={handleDrop} onDragLeave={handleDragLeave}>
        <EmptyState.Root>
          <EmptyState.Title>No items yet</EmptyState.Title>
          <EmptyState.Description>Drag an item from the bin to add it here.</EmptyState.Description>
        </EmptyState.Root>
      </div>
    );
  }

  const nodes: ReactNode[] = [];
  rows.forEach((row, index) => {
    if (dropIndex === index) nodes.push(<DropIndicator key={`drop-${index}`} />);
    nodes.push(
      row.kind === 'separator'
        ? (
          <SeparatorRow
            key={row.id}
            row={row}
            onDragOver={(event) => handleRowDragOver(index, event)}
            onDrop={handleDrop}
          />
        )
        : (
          <PlaylistItemRow
            key={row.id}
            row={row}
            onDragOver={(event) => handleRowDragOver(index, event)}
            onDrop={handleDrop}
          />
        ),
    );
  });
  if (dropIndex === rows.length) nodes.push(<DropIndicator key="drop-end" />);

  return (
    <SortableList.Root {...dnd}>
      <div className="flex flex-col gap-0.5 p-1" onDragOver={handleContainerDragOver} onDrop={handleDrop} onDragLeave={handleDragLeave}>
        {nodes}
      </div>
    </SortableList.Root>
  );
}
