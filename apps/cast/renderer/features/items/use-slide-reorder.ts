import { useCallback, useMemo } from 'react';
import type { Slide } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import { useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';

const slideId = (slide: Slide) => slide.id;

export const outlineRowId = (row: { slide: Slide }) => row.slide.id;

/**
 * `reorderSlide` already ignores an out-of-range or unchanged target and
 * rejects when the slide is gone (#214) — that rejection is what reverts the
 * optimistic order, so it is deliberately not swallowed here.
 */
export function moveSlideIdsAsBlock(orderedIds: Id[], movedIds: Id[], direction: 'up' | 'down'): Id[] {
  const moving = new Set(movedIds);
  const selected = orderedIds.filter((id) => moving.has(id));
  if (selected.length === 0) return orderedIds;

  const remaining = orderedIds.filter((id) => !moving.has(id));
  const firstIndex = orderedIds.findIndex((id) => moving.has(id));
  const insertIndex = direction === 'up'
    ? Math.max(0, firstIndex - 1)
    : Math.min(remaining.length, firstIndex + 1);
  return [
    ...remaining.slice(0, insertIndex),
    ...selected,
    ...remaining.slice(insertIndex),
  ];
}

/** Persist just the moved slides in an order that yields the complete target order. */
export async function persistSlideReorder(
  change: Pick<SortableOrderCommit, 'orderedIds' | 'movedIds' | 'previousIds'>,
  previousIds: Id[],
  reorderSlide: (slideId: Id, newOrder: number) => Promise<void>,
  currentSlideId: Id | null,
  setCurrentSlideIndex: (index: number) => void,
): Promise<void> {
  const sourceIds = change.previousIds ?? previousIds;
  const targetIndex = new Map(change.orderedIds.map((id, index) => [id, index]));
  const sourceIndex = new Map(sourceIds.map((id, index) => [id, index]));
  const moved = change.movedIds.filter((id) => targetIndex.has(id) && sourceIndex.has(id));
  const movingUp = moved
    .filter((id) => targetIndex.get(id)! < sourceIndex.get(id)!)
    .sort((left, right) => sourceIndex.get(left)! - sourceIndex.get(right)!);
  const movingDown = moved
    .filter((id) => targetIndex.get(id)! > sourceIndex.get(id)!)
    .sort((left, right) => sourceIndex.get(right)! - sourceIndex.get(left)!);

  // Process leftward moves in source order before rightward moves in reverse
  // source order. A selected block can shift some members in opposite
  // directions (and leave others at the same index).
  for (const id of [...movingUp, ...movingDown]) {
    await reorderSlide(id, targetIndex.get(id)!);
  }

  if (currentSlideId) {
    const nextIndex = targetIndex.get(currentSlideId);
    if (nextIndex !== undefined) setCurrentSlideIndex(nextIndex);
  }
}

export function useSlideReorderCommit(
  sourceIds: Id[],
  reorderSlide: (slideId: Id, newOrder: number) => Promise<void>,
  currentSlideId: Id | null,
  setCurrentSlideIndex: (index: number) => void,
) {
  return useCallback((change: SortableOrderCommit) => (
    persistSlideReorder(change, change.previousIds ?? sourceIds, reorderSlide, currentSlideId, setCurrentSlideIndex)
  ), [currentSlideId, reorderSlide, setCurrentSlideIndex, sourceIds]);
}

export function useSlideReorder(
  slides: Slide[],
  reorderSlide: (slideId: Id, newOrder: number) => Promise<void>,
  selectedIds?: ReadonlySet<Id>,
  currentSlideId: Id | null = null,
  setCurrentSlideIndex: (index: number) => void = () => undefined,
) {
  const ids = useMemo(() => slides.map(slideId), [slides]);
  const commit = useCallback((change: SortableOrderCommit) => (
    persistSlideReorder(change, change.previousIds ?? ids, reorderSlide, currentSlideId, setCurrentSlideIndex)
  ), [currentSlideId, ids, reorderSlide, setCurrentSlideIndex]);
  return useSortableOrder({ items: slides, getId: slideId, commit, selectedIds });
}
