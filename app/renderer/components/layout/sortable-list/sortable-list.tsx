import { createContext, useCallback, useContext, useMemo, useRef, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
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
  type SortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Id } from '@lumacast/kernel';
import { cn } from '@renderer/utils/cn';
import { createVirtualizedGridSortingStrategy } from './virtualized-grid-sorting-strategy';

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
  activeId?: Id | null;
  disabled?: boolean;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
  /** 'vertical' for row lists, 'grid' for thumbnail grids. */
  layout?: 'vertical' | 'grid';
  measuring?: ComponentProps<typeof DndContext>['measuring'];
  virtualizedGrid?: { columns: number } | null;
  virtualizedKeyboard?: {
    columns?: number;
    onMoveToIndex: (index: number) => void;
    scrollToIndex: (index: number) => void;
  } | null;
  dragOverlay?: ReactNode;
  children: ReactNode;
}

export const VIRTUALIZED_SORTABLE_MEASURING = {
  droppable: { strategy: MeasuringStrategy.Always },
} satisfies NonNullable<SortableListRootProps['measuring']>;

const SortableListContext = createContext({ useDragOverlay: false });

function getAnnouncementDestination(
  ids: Id[],
  activeId: Id,
  targetIndex: number,
): { position: number | null; targetId: Id | null } {
  const activeIndex = ids.indexOf(activeId);
  if (activeIndex === -1 || targetIndex < 0 || targetIndex >= ids.length) return { position: null, targetId: null };
  const targetId = targetIndex > activeIndex ? (ids[targetIndex + 1] ?? null) : (ids[targetIndex] ?? null);
  return { position: targetIndex + 1, targetId };
}

function formatDestinationAnnouncement(ids: Id[], activeId: Id, targetIndex: number) {
  const destination = getAnnouncementDestination(ids, activeId, targetIndex);
  if (destination.position == null) return undefined;
  if (destination.targetId == null) return `Moving ${activeId} to position ${destination.position} of ${ids.length}, at the end.`;
  return `Moving ${activeId} to position ${destination.position} of ${ids.length}, before ${destination.targetId}.`;
}

/**
 * Drag-to-reorder context for one list panel. Renders no DOM of its own — the
 * call site keeps whatever scroll container, grid, or flex column it already
 * had, and just wraps the rows.
 */
function Root({
  ids,
  activeId = null,
  disabled = false,
  onDragStart,
  onDragEnd,
  onDragCancel,
  layout = 'vertical',
  measuring,
  virtualizedGrid = null,
  virtualizedKeyboard = null,
  dragOverlay = null,
  children,
}: SortableListRootProps) {
  const strategy = useMemo<SortingStrategy>(() => {
    if (layout === 'grid' && virtualizedGrid) {
      return createVirtualizedGridSortingStrategy({ columns: virtualizedGrid.columns });
    }
    return layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy;
  }, [layout, virtualizedGrid?.columns]);
  const keyboardTargetIndexRef = useRef<number | null>(null);
  const lastKeyboardTargetIndexRef = useRef<number | null>(null);
  const handleRootDragStart = useCallback((event: DragStartEvent) => {
    keyboardTargetIndexRef.current = null;
    lastKeyboardTargetIndexRef.current = null;
    onDragStart(event);
  }, [onDragStart]);
  const handleRootDragEnd = useCallback((event: DragEndEvent) => {
    keyboardTargetIndexRef.current = null;
    onDragEnd(event);
  }, [onDragEnd]);
  const handleRootDragCancel = useCallback(() => {
    keyboardTargetIndexRef.current = null;
    lastKeyboardTargetIndexRef.current = null;
    onDragCancel();
  }, [onDragCancel]);
  const coordinateGetter = useMemo(() => {
    if (!virtualizedKeyboard) return sortableKeyboardCoordinates;
    return createVirtualizedKeyboardCoordinateGetter({
      fallbackIndex: activeId == null ? null : ids.indexOf(activeId),
      itemCount: ids.length,
      layout,
      columns: virtualizedKeyboard.columns ?? virtualizedGrid?.columns ?? 1,
      getCurrentIndex: () => keyboardTargetIndexRef.current,
      setCurrentIndex: (index) => {
        keyboardTargetIndexRef.current = index;
        lastKeyboardTargetIndexRef.current = index;
      },
      onMoveToIndex: virtualizedKeyboard.onMoveToIndex,
      scrollToIndex: virtualizedKeyboard.scrollToIndex,
    });
  }, [
    activeId,
    ids.length,
    layout,
    virtualizedGrid?.columns,
    virtualizedKeyboard?.columns,
    virtualizedKeyboard?.onMoveToIndex,
    virtualizedKeyboard?.scrollToIndex,
  ]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: POINTER_ACTIVATION_DISTANCE } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: TOUCH_ACTIVATION_DELAY_MS, tolerance: TOUCH_ACTIVATION_TOLERANCE },
    }),
    useSensor(KeyboardSensor, { coordinateGetter }),
  );
  const contextValue = useMemo(() => ({ useDragOverlay: dragOverlay !== null }), [dragOverlay]);
  const accessibility = useMemo<NonNullable<ComponentProps<typeof DndContext>['accessibility']>>(() => ({
    announcements: {
      onDragStart({ active }) {
        const position = ids.indexOf(String(active.id));
        if (position < 0) return undefined;
        return `Picked up ${active.id}. Current position ${position + 1} of ${ids.length}.`;
      },
      onDragOver({ active, over }) {
        const targetIndex = keyboardTargetIndexRef.current ?? lastKeyboardTargetIndexRef.current ?? (over ? ids.indexOf(String(over.id)) : ids.indexOf(String(active.id)));
        if (targetIndex < 0) return undefined;
        return formatDestinationAnnouncement(ids, String(active.id), targetIndex);
      },
      onDragEnd({ active, over }) {
        const targetIndex = keyboardTargetIndexRef.current ?? lastKeyboardTargetIndexRef.current ?? (over ? ids.indexOf(String(over.id)) : ids.indexOf(String(active.id)));
        if (targetIndex < 0) return undefined;
        const destination = getAnnouncementDestination(ids, String(active.id), targetIndex);
        if (destination.position == null) return undefined;
        if (destination.targetId == null) return `Dropped ${active.id} at position ${destination.position} of ${ids.length}, at the end.`;
        return `Dropped ${active.id} at position ${destination.position} of ${ids.length}, before ${destination.targetId}.`;
      },
      onDragCancel({ active }) {
        return `Cancelled dragging ${active.id}.`;
      },
    },
  }), [ids]);

  return (
    <SortableListContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        measuring={measuring}
        accessibility={accessibility}
        onDragStart={handleRootDragStart}
        onDragEnd={handleRootDragEnd}
        onDragCancel={handleRootDragCancel}
      >
        <SortableContext
          items={ids}
          disabled={disabled}
          strategy={strategy}
        >
          {children}
        </SortableContext>
        {dragOverlay !== null && activeId !== null && typeof document !== 'undefined'
          ? createPortal(
              <DragOverlay wrapperElement="div" zIndex={2000} className="pointer-events-none">
                <div
                  aria-hidden="true"
                  inert
                  data-drag-overlay-root
                  className="pointer-events-none"
                >
                  {dragOverlay}
                </div>
              </DragOverlay>,
              document.body,
            )
          : null}
      </DndContext>
    </SortableListContext.Provider>
  );
}

function createVirtualizedKeyboardCoordinateGetter({
  fallbackIndex,
  itemCount,
  layout,
  columns,
  getCurrentIndex,
  setCurrentIndex,
  onMoveToIndex,
  scrollToIndex,
}: {
  fallbackIndex: number | null;
  itemCount: number;
  layout: 'vertical' | 'grid';
  columns: number;
  getCurrentIndex: () => number | null;
  setCurrentIndex: (index: number) => void;
  onMoveToIndex: (index: number) => void;
  scrollToIndex: (index: number) => void;
}) {
  return (event: KeyboardEvent, args: Parameters<typeof sortableKeyboardCoordinates>[1]) => {
    const fallbackCoordinates = sortableKeyboardCoordinates(event, args);
    const nextIndex = getNextKeyboardIndex({
      code: event.code,
      columns,
      currentIndex: getCurrentIndex(),
      fallbackIndex,
      itemCount,
      layout,
    });

    if (nextIndex === null) return fallbackCoordinates;

    setCurrentIndex(nextIndex);
    onMoveToIndex(nextIndex);
    scrollToIndex(nextIndex);

    return fallbackCoordinates ?? args.currentCoordinates;
  };
}

function getNextKeyboardIndex({
  code,
  columns,
  currentIndex,
  fallbackIndex,
  itemCount,
  layout,
}: {
  code: string;
  columns: number;
  currentIndex: number | null;
  fallbackIndex: number | null;
  itemCount: number;
  layout: 'vertical' | 'grid';
}) {
  const resolvedCurrentIndex = currentIndex ?? fallbackIndex;
  if (resolvedCurrentIndex == null) return null;
  const current = resolvedCurrentIndex;
  if (current === -1) return null;

  if (layout === 'vertical') {
    if (code === 'ArrowDown' && current < itemCount - 1) return current + 1;
    if (code === 'ArrowUp' && current > 0) return current - 1;
    return null;
  }

  const columnCount = Math.max(1, columns);
  if (code === 'ArrowRight' && current < itemCount - 1 && current % columnCount < columnCount - 1) {
    return current + 1;
  }
  if (code === 'ArrowLeft' && current > 0 && current % columnCount > 0) {
    return current - 1;
  }
  if (code === 'ArrowDown' && current + columnCount < itemCount) return current + columnCount;
  if (code === 'ArrowUp' && current - columnCount >= 0) return current - columnCount;

  return null;
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
  const { useDragOverlay } = useContext(SortableListContext);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const isSourceDragging = isDragging && !useDragOverlay;
  const containerStyle = useMemo<CSSProperties>(() => ({
    transform: CSS.Transform.toString(transform),
    transition,
    // Lift the dragged row above its neighbours; without the positioning
    // context a transformed sibling can paint over it mid-drag.
    zIndex: isDragging ? 40 : undefined,
    position: isDragging ? 'relative' : undefined,
    opacity: isSourceDragging ? 0.6 : undefined,
  }), [isDragging, isSourceDragging, transform, transition]);
  const handleProps = useMemo<Record<string, unknown>>(
    () => (disabled ? {} : { ...attributes, ...listeners }),
    [attributes, disabled, listeners],
  );

  return {
    containerRef: setNodeRef,
    containerStyle,
    isDragging: isSourceDragging,
    handleProps,
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
