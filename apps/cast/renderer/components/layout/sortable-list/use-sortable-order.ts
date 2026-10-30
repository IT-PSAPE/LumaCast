import { useCallback, useMemo, useRef, useState } from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { Id } from '@lumacast/kernel';
import { moveSelectedIds } from '@lumacast/selection';

/**
 * What a drop resolved to. `toIndex` is the drop position in the *visible*
 * list, which is what every `set…Order` IPC op takes: they lift the row out
 * and reinsert it at that index (remove-then-insert), so a plain dnd-kit
 * `over` index maps across without adjustment.
 */
export interface SortableOrderCommit {
  id: Id;
  fromIndex: number;
  toIndex: number;
  /** The full id list in its new order — for callers that persist a whole ordering at once. */
  orderedIds: Id[];
  /** Dragged members in their existing relative order. */
  movedIds: Id[];
  /** Visible order at drop start, before the selected block is moved. */
  previousIds?: Id[];
}

export interface SortableOrderOptions<T> {
  /** Server-ordered items, straight from the snapshot. */
  items: T[];
  /** Must be stable across renders (module-level fn or useCallback). */
  getId: (item: T) => Id;
  /**
   * Persists the drop. Rejecting reverts the optimistic order, so callers must
   * NOT swallow their mutation's rejection here the way one-shot menu actions
   * do — let it propagate and this hook puts the row back.
   */
  commit: (change: SortableOrderCommit) => Promise<unknown> | unknown;
  disabled?: boolean;
  selectedIds?: ReadonlySet<Id>;
}

export interface SortableOrderResult<T> {
  /** Items in the order to render: optimistic while a drop is in flight. */
  items: T[];
  /** True while at least one drop is still being persisted. */
  isCommitting: boolean;
  /** Spread onto SortableList.Root. */
  dnd: {
    ids: Id[];
    activeId: Id | null;
    disabled: boolean;
    onKeyboardMoveToIndex: (toIndex: number) => void;
    onDragStart: (event: DragStartEvent) => void;
    onDragEnd: (event: DragEndEvent) => void;
    onDragCancel: () => void;
  };
}

/**
 * Optimistic list ordering for drag-and-drop reorder.
 *
 * The snapshot round-trip (IPC → SQLite → patch) lands a frame or more after
 * the drop, and dnd-kit animates the dragged row back to wherever the data
 * still says it belongs. Without an optimistic layer that reads as the row
 * snapping back to its old position and then jumping to the new one. So a drop
 * writes an override order immediately and the override is dropped the moment
 * the last in-flight commit settles — by which point `mutatePatch` has already
 * applied its patch, so the handoff is invisible. A rejected commit therefore
 * reverts by exactly the same path (see `commit` above).
 *
 * Dragging is disabled while a drop is being persisted: grouped per-item APIs
 * must finish before another gesture derives indices from their result.
 *
 * The override is also frozen for the duration of a drag, so a snapshot that
 * arrives mid-gesture (another window, an undo, a macro) cannot re-sort the
 * list under the cursor. Items that vanish while frozen drop out; items that
 * appear are appended until the gesture ends.
 */
export function useSortableOrder<T>({
  items,
  getId,
  commit,
  disabled = false,
  selectedIds,
}: SortableOrderOptions<T>): SortableOrderResult<T> {
  const [overrideIds, setOverrideIds] = useState<Id[] | null>(null);
  const [activeId, setActiveId] = useState<Id | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  // Frozen for the duration of a drag; a ref (not state) because the freeze is
  // taken during the drag-start event, before the next render.
  const frozenIdsRef = useRef<Id[] | null>(null);
  const dragSourceIdsRef = useRef<Id[] | null>(null);
  const blockedDragRef = useRef(false);
  const draggedIdsRef = useRef<ReadonlySet<Id>>(new Set());
  const pendingCommitsRef = useRef(0);
  const keyboardOrderRef = useRef<Id[] | null>(null);

  const serverIds = useMemo(() => items.map(getId), [items, getId]);

  const activeIds = isDragging ? keyboardOrderRef.current ?? frozenIdsRef.current ?? overrideIds : overrideIds;

  const orderedItems = useMemo(() => {
    if (!activeIds) return items;
    const byId = new Map<Id, T>();
    for (const item of items) byId.set(getId(item), item);

    const ordered: T[] = [];
    const placed = new Set<Id>();
    for (const id of activeIds) {
      const item = byId.get(id);
      // Deleted underneath us (concurrent delete, undo): it simply drops out.
      if (!item) continue;
      ordered.push(item);
      placed.add(id);
    }
    // Anything that appeared underneath us keeps its server-relative position
    // at the end rather than disappearing until the override clears.
    for (const item of items) {
      if (!placed.has(getId(item))) ordered.push(item);
    }
    return ordered;
  }, [activeIds, getId, items]);

  const visibleIds = useMemo(() => orderedItems.map(getId), [getId, orderedItems]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    blockedDragRef.current = pendingCommitsRef.current > 0;
    if (blockedDragRef.current) return;
    frozenIdsRef.current = visibleIds;
    dragSourceIdsRef.current = serverIds;
    const id = String(event.active.id);
    draggedIdsRef.current = selectedIds?.has(id) ? new Set(selectedIds) : new Set([id]);
    keyboardOrderRef.current = null;
    setActiveId(String(event.active.id));
    setIsDragging(true);
  }, [selectedIds, serverIds, visibleIds]);

  const endDrag = useCallback(() => {
    frozenIdsRef.current = null;
    dragSourceIdsRef.current = null;
    keyboardOrderRef.current = null;
    setActiveId(null);
    setIsDragging(false);
  }, []);

  const cancelDrag = useCallback(() => {
    endDrag();
    if (pendingCommitsRef.current === 0) setOverrideIds(null);
  }, [endDrag]);

  const handleKeyboardMoveToIndex = useCallback((toIndex: number) => {
    if (activeId === null) return;
    const currentIds = keyboardOrderRef.current ?? frozenIdsRef.current ?? visibleIds;
    const fromIndex = currentIds.indexOf(activeId);

    if (fromIndex === -1 || toIndex < 0 || toIndex >= currentIds.length || fromIndex === toIndex) return;

    const direction = toIndex > fromIndex ? 1 : -1;
    let targetIndex = toIndex;
    while (targetIndex >= 0 && targetIndex < currentIds.length && draggedIdsRef.current.has(currentIds[targetIndex])) targetIndex += direction;
    if (targetIndex < 0 || targetIndex >= currentIds.length) return;
    const nextIds = moveSelectedIds(currentIds, activeId, targetIndex, draggedIdsRef.current);
    keyboardOrderRef.current = nextIds;
    setOverrideIds(nextIds);
  }, [activeId, visibleIds]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (blockedDragRef.current) {
      blockedDragRef.current = false;
      return;
    }
    const { active, over } = event;
    const sourceIds = dragSourceIdsRef.current;
    const frozenIds = frozenIdsRef.current ?? visibleIds;
    const available = new Set(serverIds);
    const baseIds = [...frozenIds.filter((id) => available.has(id)), ...serverIds.filter((id) => !frozenIds.includes(id))];
    const keyboardOrder = keyboardOrderRef.current;
    endDrag();

    // An external reorder invalidates absolute per-item destinations. Keep the
    // authoritative order and let the operator start a new gesture.
    if (sourceIds) {
      const originalIds = new Set(sourceIds);
      const survivingSource = sourceIds.filter((id) => available.has(id));
      const survivingCurrent = serverIds.filter((id) => originalIds.has(id));
      if (survivingSource.some((id, index) => id !== survivingCurrent[index])) {
        if (pendingCommitsRef.current === 0) setOverrideIds(null);
        return;
      }
    }

    const activeId = String(active.id);
    const fromIndex = baseIds.indexOf(activeId);
    const toIndex = keyboardOrder ? keyboardOrder.filter((id) => available.has(id)).indexOf(activeId) : over ? baseIds.indexOf(String(over.id)) : -1;
    // The dragged row (or its target) was deleted mid-gesture: there is no
    // meaningful destination left, so the drop is dropped.
    if (fromIndex === -1 || toIndex === -1 || (!keyboardOrder && fromIndex === toIndex)) {
      if (pendingCommitsRef.current === 0) setOverrideIds(null);
      return;
    }
    // Same guard against a row that survived the gesture visually but is gone
    // from the snapshot the commit would be computed against.
    if (!serverIds.includes(activeId)) return;

    const moving = draggedIdsRef.current.has(activeId) ? draggedIdsRef.current : new Set([activeId]);
    const nextIds = keyboardOrder
      ? [...keyboardOrder.filter((id) => available.has(id)), ...baseIds.filter((id) => !keyboardOrder.includes(id))]
      : moveSelectedIds(baseIds, activeId, toIndex, moving);
    if (nextIds.length === baseIds.length && nextIds.every((id, index) => id === baseIds[index])) {
      if (pendingCommitsRef.current === 0) setOverrideIds(null);
      return;
    }
    const movedIds = baseIds.filter((id) => moving.has(id));

    setOverrideIds(nextIds);
    pendingCommitsRef.current += 1;
    setIsCommitting(true);

    const settle = () => {
      pendingCommitsRef.current -= 1;
      if (pendingCommitsRef.current > 0) return;
      // Optimism ends when persistence does: on success the snapshot already
      // carries this order, on failure the row returns to where it was.
      setOverrideIds(null);
      setIsCommitting(false);
    };

    const failed = (error: unknown) => {
      settle();
      // mutatePatch has already logged and surfaced "Operation failed"; this
      // keeps an unexpected commit error from becoming an unhandled rejection.
      console.error('[useSortableOrder] Reorder failed, reverted:', error);
    };

    // Called synchronously so the mutation queues in the same task as the drop:
    // two quick drags then reach the store in the order they were made.
    let outcome: Promise<unknown> | unknown;
    try {
      outcome = commit({ id: activeId, fromIndex, toIndex, orderedIds: nextIds, movedIds, previousIds: baseIds });
    } catch (error) {
      failed(error);
      return;
    }
    void Promise.resolve(outcome).then(settle, failed);
  }, [commit, endDrag, serverIds, visibleIds]);

  const dnd = useMemo(() => ({
    ids: visibleIds,
    activeId,
    disabled: disabled || visibleIds.length < 2 || isCommitting,
    onKeyboardMoveToIndex: handleKeyboardMoveToIndex,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragCancel: cancelDrag,
  }), [activeId, cancelDrag, disabled, handleDragEnd, handleDragStart, handleKeyboardMoveToIndex, isCommitting, visibleIds]);

  return { items: orderedItems, isCommitting, dnd };
}
