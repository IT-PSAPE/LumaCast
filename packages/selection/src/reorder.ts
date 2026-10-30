export interface SelectedReorderCommit {
  fromIndex: number;
  toIndex: number;
  orderedIds: string[];
  movedIds: string[];
  previousIds?: string[];
}

/** Insert selected members into a gap measured in the original visible order. */
export function moveSelectionToGap(
  ids: string[],
  selectedIds: ReadonlySet<string>,
  gapIndex: number,
): string[] {
  if (!Number.isFinite(gapIndex)) return ids;
  const gap = Math.max(0, Math.min(ids.length, Math.trunc(gapIndex)));
  const moving = ids.filter((id) => selectedIds.has(id));
  if (moving.length === 0) return ids;
  const remaining = ids.filter((id) => !selectedIds.has(id));
  const insertion = gap - ids.slice(0, gap).filter((id) => selectedIds.has(id)).length;
  const next = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)];
  return next.every((id, index) => id === ids[index]) ? ids : next;
}

/** Move the active row and its selected peers as one block around the target. */
export function moveSelectedIds(
  ids: string[],
  activeId: string,
  toIndex: number,
  selectedIds: ReadonlySet<string>,
): string[] {
  const fromIndex = ids.indexOf(activeId);
  if (fromIndex < 0 || toIndex < 0 || toIndex >= ids.length || fromIndex === toIndex) return ids;
  const moving = selectedIds.has(activeId) ? selectedIds : new Set([activeId]);
  const target = ids[toIndex];
  if (moving.has(target)) return ids;
  const moved = ids.filter((id) => moving.has(id));
  const remaining = ids.filter((id) => !moving.has(id));
  const insertIndex = remaining.indexOf(target) + (toIndex > fromIndex ? 1 : 0);
  return [...remaining.slice(0, insertIndex), ...moved, ...remaining.slice(insertIndex)];
}

/** Persist a grouped reorder through APIs that move one id to one absolute index. */
export async function commitSelectedReorder(
  change: SelectedReorderCommit,
  reorder: (id: string, index: number) => Promise<unknown> | unknown,
): Promise<void> {
  const previousIds = change.previousIds;
  if (!previousIds) {
    // Without source indices there is no safe direction-aware partial order.
    // Rebuild the whole target order from left to right instead.
    for (let index = 0; index < change.orderedIds.length; index += 1) {
      await reorder(change.orderedIds[index], index);
    }
    return;
  }

  const sourceIndex = new Map(previousIds.map((id, index) => [id, index]));
  const targetIndex = new Map(change.orderedIds.map((id, index) => [id, index]));
  const movingUp: string[] = [];
  const movingDown: string[] = [];

  for (const id of change.movedIds) {
    const from = sourceIndex.get(id);
    const to = targetIndex.get(id);
    if (from === undefined || to === undefined || from === to) continue;
    if (to < from) movingUp.push(id);
    else movingDown.push(id);
  }

  movingUp.sort((a, b) => sourceIndex.get(a)! - sourceIndex.get(b)!);
  movingDown.sort((a, b) => sourceIndex.get(b)! - sourceIndex.get(a)!);

  for (const id of [...movingUp, ...movingDown]) {
    const index = targetIndex.get(id);
    if (index !== undefined) await reorder(id, index);
  }
}
