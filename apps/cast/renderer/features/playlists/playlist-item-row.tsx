import type { PlaylistItemEntry } from '@lumacast/composition';
import { ContextMenu } from '@lumacast/ui';
import { useSortableItem } from '../../components/layout/sortable-list';
import { PlaylistItemRowBody } from './playlist-item-row-body';
import type { RowDragProps } from './row-drag-props';
import type { PlaylistRowSelectionProps } from './row-selection-props';

interface PlaylistItemRowProps extends RowDragProps, PlaylistRowSelectionProps {
  row: PlaylistItemEntry;
  overlay?: boolean;
}

export function PlaylistItemRow(props: PlaylistItemRowProps) {
  if (props.overlay) return <PlaylistItemRowBody {...props} />;
  return <SortablePlaylistItemRow {...props} />;
}

function SortablePlaylistItemRow({ row, onDragOver, onDrop, isMultiSelected, actionRows, onSelectionClick, onRemoveRows, onMoveRows }: PlaylistItemRowProps) {
  const { containerRef, containerStyle, isDragging, handleProps } = useSortableItem(row.id);

  return (
    <ContextMenu.Root>
      <PlaylistItemRowBody
        row={row}
        onDragOver={onDragOver}
        onDrop={onDrop}
        containerRef={containerRef}
        containerStyle={containerStyle}
        dragging={isDragging}
        dragHandleProps={handleProps}
        isMultiSelected={isMultiSelected}
        actionRows={actionRows}
        onSelectionClick={onSelectionClick}
        onRemoveRows={onRemoveRows}
        onMoveRows={onMoveRows}
      />
    </ContextMenu.Root>
  );
}
