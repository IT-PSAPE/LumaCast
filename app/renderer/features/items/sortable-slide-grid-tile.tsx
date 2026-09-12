import { type ComponentProps } from 'react';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import { SlideGridTile } from './slide-grid-tile';

export function SortableSlideGridTile(props: ComponentProps<typeof SlideGridTile>) {
  const { containerRef, containerStyle, isDragging, handleProps } = useSortableItem(props.slideId);
  return (
    <SlideGridTile
      {...props}
      containerRef={containerRef}
      containerStyle={containerStyle}
      dragging={isDragging}
      dragHandleProps={handleProps}
    />
  );
}
