import type { PlaylistSeparator } from '@lumacast/composition';
import { ContextMenu } from '../../components/overlays/context-menu';
import { useSortableItem } from '../../components/layout/sortable-list';
import { SeparatorRowBody } from './separator-row-body';
import type { RowDragProps } from './row-drag-props';

interface SeparatorRowProps extends RowDragProps {
  row: PlaylistSeparator;
  overlay?: boolean;
}

export function SeparatorRow(props: SeparatorRowProps) {
  if (props.overlay) return <SeparatorRowBody {...props} />;
  return <SortableSeparatorRow {...props} />;
}

function SortableSeparatorRow({ row, onDragOver, onDrop }: SeparatorRowProps) {
  const { containerRef, containerStyle, isDragging, handleProps } = useSortableItem(row.id);

  return (
    <ContextMenu.Root>
      <SeparatorRowBody
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
