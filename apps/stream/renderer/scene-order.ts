// Pure id-array helpers for reordering the Scenes dock list. These operate on
// scene ids only (not `StreamScene` objects) so the dock can derive the next
// `project.scenes` order — via the Order submenu, Ctrl/Cmd+Arrow, or a pointer
// drag — without this module knowing the scene shape.
import { moveSelectionToGap } from '@lumacast/selection';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Moves `id` by `delta` positions (-1 = up, +1 = down). A delta that would
 * carry it past either end clamps there instead of wrapping. Unknown ids and
 * no-op moves both return a list equal to `ids`.
 */
export function moveSceneBy(ids: readonly string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return [...ids];
  return moveSceneTo(ids, id, from + delta);
}

/**
 * Moves `id` to `index`, clamped to the list bounds. Unknown ids and an
 * `index` matching the current position both return a list equal to `ids`.
 */
export function moveSceneTo(ids: readonly string[], id: string, index: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return [...ids];
  const target = clamp(index, 0, ids.length - 1);
  if (target === from) return [...ids];
  const next = ids.filter((candidate) => candidate !== id);
  next.splice(target, 0, id);
  return next;
}

/**
 * Reorders after a pointer drop. `targetIndex` is where the drop-indicator
 * line sat among the *original* rows — 0..`ids.length`, where `ids.length`
 * means "after the last row" — independent of which row is being dragged
 * (the caller doesn't need to account for the dragged row's own gap). Dropping
 * a row back into its own gap (immediately before or after its current
 * position) is a no-op.
 */
export function reorderOnDrop(ids: readonly string[], draggedId: string, targetIndex: number): string[] {
  const from = ids.indexOf(draggedId);
  if (from === -1) return [...ids];
  const clampedTarget = clamp(targetIndex, 0, ids.length);
  const insertAt = clampedTarget > from ? clampedTarget - 1 : clampedTarget;
  if (insertAt === from) return [...ids];
  const next = ids.filter((candidate) => candidate !== draggedId);
  next.splice(insertAt, 0, draggedId);
  return next;
}

/** Reorders the selected rows as a stable block at a gap in the original list. */
export function reorderSelectionOnDrop(
  ids: readonly string[],
  draggedId: string,
  targetIndex: number,
  selectedIds: ReadonlySet<string>,
): string[] {
  if (!ids.includes(draggedId)) return [...ids];
  const moving = selectedIds.has(draggedId) ? selectedIds : new Set([draggedId]);
  return moveSelectionToGap(ids.slice(), moving, targetIndex);
}
