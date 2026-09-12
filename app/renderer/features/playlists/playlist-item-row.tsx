import type { PlaylistItemEntry } from '@lumacast/composition';
import { ContextMenu } from '../../components/overlays/context-menu';
import { useSortableItem } from '../../components/layout/sortable-list';
import { PlaylistItemRowBody } from './playlist-item-row-body';
import type { RowDragProps } from './row-drag-props';

interface PlaylistItemRowProps extends RowDragProps {
  row: PlaylistItemEntry;
  overlay?: boolean;
}

export function PlaylistItemRow(props: PlaylistItemRowProps) {
  if (props.overlay) return <PlaylistItemRowBody {...props} />;
  return <SortablePlaylistItemRow {...props} />;
}

function SortablePlaylistItemRow({ row, onDragOver, onDrop }: PlaylistItemRowProps) {
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
      />
    </ContextMenu.Root>
  );
}
