import { useCallback } from 'react';
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
export function useSlideReorderCommit(reorderSlide: (slideId: Id, newOrder: number) => Promise<void>) {
  return useCallback(
    ({ id, toIndex }: SortableOrderCommit) => reorderSlide(id, toIndex),
    [reorderSlide],
  );
}

export function useSlideReorder(slides: Slide[], reorderSlide: (slideId: Id, newOrder: number) => Promise<void>) {
  return useSortableOrder({ items: slides, getId: slideId, commit: useSlideReorderCommit(reorderSlide) });
}
