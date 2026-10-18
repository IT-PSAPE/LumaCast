// Pure helpers for pointer-drag reordering in the Sources dock.
//
// A source's siblings (`scene.sources`, or a group's `children`) are stored
// back-to-front, and `sources-dock.tsx` renders them top-to-bottom in the
// *reverse* of that order (front-most row first — see `renderSourceRows`).
// These helpers translate a drop position computed in *display* order into
// the *storage*-order sibling id list that `onReorderSources` hands back to
// the caller, reusing the flat-array reorder math already proven out for the
// Scenes dock (`reorderOnDrop`) rather than re-deriving it.

import { reorderOnDrop } from './scene-order';

/**
 * Reorders a sibling id list (stored back-to-front) after a pointer drop.
 * `displayDropIndex` is where the drop-indicator line sat among the
 * *displayed* (top-to-bottom, front-most first) sibling rows —
 * 0..`storageIds.length`, independent of which row is being dragged (the
 * caller doesn't need to account for the dragged row's own gap). Returns the
 * new sibling ids in storage order, ready to write back as `scene.sources` or
 * a group's `children`. Unknown ids and no-op drops both return a list equal
 * to `storageIds`.
 */
export function reorderSourceSiblingsOnDrop(
  storageIds: readonly string[],
  draggedId: string,
  displayDropIndex: number,
): string[] {
  const clampedDisplayIndex = Math.max(0, Math.min(storageIds.length, displayDropIndex));
  const storageDropIndex = storageIds.length - clampedDisplayIndex;
  return reorderOnDrop(storageIds, draggedId, storageDropIndex);
}

/**
 * Computes the single-step `onMoveSource` fallback for a sibling reorder,
 * used when `onReorderSources` is not provided. Returns the direction and
 * step count needed to reach `nextStorageIds` from `previousStorageIds` by
 * repeatedly moving `draggedId` one position at a time — matching
 * `moveSourceTreeNode`'s step semantics, which is what `onMoveSource` is
 * expected to call under the hood. Returns `null` when there is nothing to do
 * (unknown id, or the two lists already agree on its position).
 */
export function fallbackSourceMoveSteps(
  previousStorageIds: readonly string[],
  nextStorageIds: readonly string[],
  draggedId: string,
): { direction: -1 | 1; steps: number } | null {
  const from = previousStorageIds.indexOf(draggedId);
  const to = nextStorageIds.indexOf(draggedId);
  if (from === -1 || to === -1 || from === to) return null;
  return { direction: to > from ? 1 : -1, steps: Math.abs(to - from) };
}
