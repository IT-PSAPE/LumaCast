import { useCallback, useMemo, useRef, useState } from 'react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { Id } from '@lumacast/kernel';

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
 * Ordering under concurrent drops: each drop computes its indices against the
 * currently *visible* order, and `mutatePatch` serializes the IPC calls in
 * submission order, so a second drag that starts before the first has
 * persisted still lands where the operator dropped it.
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
}: SortableOrderOptions<T>): SortableOrderResult<T> {
  const [overrideIds, setOverrideIds] = useState<Id[] | null>(null);
  const [activeId, setActiveId] = useState<Id | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  // Frozen for the duration of a drag; a ref (not state) because the freeze is
  // taken during the drag-start event, before the next render.
  const frozenIdsRef = useRef<Id[] | null>(null);
  const pendingCommitsRef = useRef(0);
  const keyboardDropIndexRef = useRef<number | null>(null);

  const serverIds = useMemo(() => items.map(getId), [items, getId]);

  const activeIds = isDragging ? frozenIdsRef.current ?? overrideIds : overrideIds;

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
    frozenIdsRef.current = visibleIds;
    keyboardDropIndexRef.current = null;
    setActiveId(String(event.active.id));
    setIsDragging(true);
  }, [visibleIds]);

  const endDrag = useCallback(() => {
    frozenIdsRef.current = null;
    keyboardDropIndexRef.current = null;
    setActiveId(null);
    setIsDragging(false);
  }, []);

  const handleKeyboardMoveToIndex = useCallback((toIndex: number) => {
    if (activeId === null) return;
    const currentIds = overrideIds ?? frozenIdsRef.current ?? visibleIds;
    const fromIndex = currentIds.indexOf(activeId);

    if (fromIndex === -1 || toIndex < 0 || toIndex >= currentIds.length || fromIndex === toIndex) return;

    const nextIds = currentIds.slice();
    nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, activeId);
    keyboardDropIndexRef.current = toIndex;
    setOverrideIds(nextIds);
  }, [activeId, overrideIds, visibleIds]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    const baseIds = frozenIdsRef.current ?? visibleIds;
    const keyboardDropIndex = keyboardDropIndexRef.current;
    endDrag();

    const activeId = String(active.id);
    const fromIndex = baseIds.indexOf(activeId);
    const toIndex = keyboardDropIndex ?? (over ? baseIds.indexOf(String(over.id)) : -1);
    // The dragged row (or its target) was deleted mid-gesture: there is no
    // meaningful destination left, so the drop is dropped.
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
    // Same guard against a row that survived the gesture visually but is gone
    // from the snapshot the commit would be computed against.
    if (!serverIds.includes(activeId)) return;

    const nextIds = baseIds.slice();
    nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, activeId);

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
      outcome = commit({ id: activeId, fromIndex, toIndex, orderedIds: nextIds });
    } catch (error) {
      failed(error);
      return;
    }
    void Promise.resolve(outcome).then(settle, failed);
  }, [commit, endDrag, serverIds, visibleIds]);

  const dnd = useMemo(() => ({
    ids: visibleIds,
    activeId,
    disabled: disabled || visibleIds.length < 2,
    onKeyboardMoveToIndex: handleKeyboardMoveToIndex,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
    onDragCancel: endDrag,
  }), [activeId, disabled, endDrag, handleDragEnd, handleDragStart, handleKeyboardMoveToIndex, visibleIds]);

  return { items: orderedItems, isCommitting, dnd };
}
