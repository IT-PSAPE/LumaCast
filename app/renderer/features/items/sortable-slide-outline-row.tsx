import { type ComponentProps } from 'react';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import { SlideOutlineRow } from './slide-list-row';

export function SortableSlideOutlineRow(props: ComponentProps<typeof SlideOutlineRow>) {
  const { containerRef, containerStyle, isDragging, handleProps } = useSortableItem(props.row.slide.id);
  return (
    <SlideOutlineRow
      {...props}
      containerRef={containerRef}
      containerStyle={containerStyle}
      dragging={isDragging}
      dragHandleProps={handleProps}
    />
  );
}
