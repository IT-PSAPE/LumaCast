import type { CSSProperties, ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Id } from '@lumacast/kernel';
import { cn } from '@renderer/utils/cn';

// Whole-row drag with a 5px activation distance: a click that never travels
// that far still selects the row and a double-click still opens its rename
// field, so no list needs a dedicated grip. Touch waits 180ms instead, or a
// scroll gesture inside a panel would pick rows up.
const POINTER_ACTIVATION_DISTANCE = 5;
const TOUCH_ACTIVATION_DELAY_MS = 180;
const TOUCH_ACTIVATION_TOLERANCE = 6;

export interface SortableListRootProps {
  /** Visible id order — pass `dnd.ids` from useSortableOrder. */
  ids: Id[];
  disabled?: boolean;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  /** 'vertical' for row lists, 'grid' for thumbnail grids. */
  layout?: 'vertical' | 'grid';
  children: ReactNode;
}

/**
 * Drag-to-reorder context for one list panel. Renders no DOM of its own — the
 * call site keeps whatever scroll container, grid, or flex column it already
 * had, and just wraps the rows.
 */
function Root({
  ids,
  disabled = false,
  onDragStart,
  onDragEnd,
  onDragCancel,
  layout = 'vertical',
  children,
}: SortableListRootProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: POINTER_ACTIVATION_DISTANCE } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: TOUCH_ACTIVATION_DELAY_MS, tolerance: TOUCH_ACTIVATION_TOLERANCE },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext
        items={ids}
        disabled={disabled}
        strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

export interface SortableItemState {
  containerRef: (node: HTMLElement | null) => void;
  containerStyle: CSSProperties;
  isDragging: boolean;
  /**
   * Drag activators plus dnd-kit's a11y attributes (role, tabIndex,
   * aria-roledescription). Spread these on whichever element should start the
   * drag — put them on an element that is already interactive rather than on a
   * wrapper around it, so the row keeps a single tab stop.
   */
  handleProps: Record<string, unknown>;
}

/**
 * Escape hatch for rows that are already an interactive element (a real
 * `<button>` row, a thumbnail tile with its own props contract): take the
 * pieces and wire them up by hand. Row lists made of plain divs should use
 * `SortableList.Item` instead.
 */
export function useSortableItem(id: Id, disabled = false): SortableItemState {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });

  return {
    containerRef: setNodeRef,
    containerStyle: {
      transform: CSS.Transform.toString(transform),
      transition,
      // Lift the dragged row above its neighbours; without the positioning
      // context a transformed sibling can paint over it mid-drag.
      zIndex: isDragging ? 40 : undefined,
      position: isDragging ? 'relative' : undefined,
      opacity: isDragging ? 0.6 : undefined,
    },
    isDragging,
    handleProps: disabled ? {} : { ...attributes, ...listeners },
  };
}

export interface SortableListItemProps {
  id: Id;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

/** One draggable row: a plain wrapper that is itself the drag handle. */
function Item({ id, disabled = false, className, children }: SortableListItemProps) {
  const { containerRef, containerStyle, isDragging, handleProps } = useSortableItem(id, disabled);

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      {...handleProps}
      data-dragging={isDragging || undefined}
      className={cn(!disabled && 'cursor-grab active:cursor-grabbing', className)}
    >
      {children}
    </div>
  );
}

export const SortableList = { Root, Item };
