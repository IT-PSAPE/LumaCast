import { useCallback } from 'react';
import type { Slide } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import { useConfirm } from '@lumacast/ui';

interface SlideBulkActions {
  slides: Slide[];
  duplicateSlide: (id: Id) => Promise<void>;
  deleteSlide: (id: Id) => Promise<void>;
}

/** Shared menu and keyboard actions for a slide selection. */
export function useSlideBulkActions({ slides, duplicateSlide, deleteSlide }: SlideBulkActions) {
  const confirm = useConfirm();
  const getAuthoredIds = useCallback((ids: Id[]) => {
    const seen = new Set<Id>();
    return ids.filter((id) => {
      if (seen.has(id) || !slides.some((slide) => slide.id === id && !slide.runtimeBlank)) return false;
      seen.add(id);
      return true;
    });
  }, [slides]);

  const duplicateSlides = useCallback(async (ids: Id[]) => {
    for (const id of getAuthoredIds(ids)) await duplicateSlide(id);
  }, [duplicateSlide, getAuthoredIds]);

  const deleteSlides = useCallback(async (ids: Id[]) => {
    const authoredIds = getAuthoredIds(ids);
    if (authoredIds.length === 0) return;
    const ok = await confirm({
      title: authoredIds.length === 1 ? 'Delete slide?' : `Delete ${authoredIds.length} slides?`,
      description: authoredIds.length === 1
        ? 'This slide and all its elements will be permanently removed.'
        : 'These slides and all their elements will be permanently removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    for (const id of [...authoredIds].reverse()) await deleteSlide(id);
  }, [confirm, deleteSlide, getAuthoredIds]);

  return { duplicateSlides, deleteSlides };
}
