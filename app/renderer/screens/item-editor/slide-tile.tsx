import { ContextMenu } from '../../components/overlays/context-menu';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import { SlideTileBody, type SlideTileProps } from './slide-tile-body';

export function SlideTile(props: SlideTileProps) {
  if (props.overlay) return <SlideTileBody {...props} />;
  return (
    <ContextMenu.Root>
      <SlideTileBody
        {...props}
      />
    </ContextMenu.Root>
  );
}

export function SortableSlideTile(props: SlideTileProps) {
  const { containerRef, containerStyle, isDragging, handleProps } = useSortableItem(props.slideId);

  return (
    <ContextMenu.Root>
      <SlideTileBody
        {...props}
        containerRef={containerRef}
        containerStyle={containerStyle}
        dragging={isDragging}
        dragHandleProps={handleProps}
      />
    </ContextMenu.Root>
  );
}
