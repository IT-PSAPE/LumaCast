export interface SelectionModifiers {
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface ResolvedSelection {
  selectedIds: string[];
  anchorId: string | null;
}

/** Remove IDs outside the caller's allowed scope while preserving selection order. */
export function filterSelectionIds(currentIds: readonly string[], selectableIds: ReadonlySet<string>): string[] {
  return currentIds.filter((id) => selectableIds.has(id));
}

/** Toggle one ID, choosing where a newly selected ID enters the primary order. */
export function toggleSelectionId(
  currentIds: readonly string[],
  id: string,
  insertion: 'front' | 'back' = 'back',
): string[] {
  if (currentIds.includes(id)) return currentIds.filter((currentId) => currentId !== id);
  return insertion === 'front' ? [id, ...currentIds] : [...currentIds, id];
}

/** Resolve a visible click against caller-owned selection and visibility scopes. */
export function resolveSelection(
  orderedIds: readonly string[],
  currentIds: readonly string[],
  anchorId: string | null,
  clickedId: string,
  modifiers: SelectionModifiers = {},
  selectableIds: readonly string[] = orderedIds,
): ResolvedSelection {
  const selectable = Array.from(new Set(selectableIds));
  const allowed = new Set(selectable);
  const visibleIds = Array.from(new Set(orderedIds)).filter((id) => allowed.has(id));
  const visible = new Set(visibleIds);
  const scopedOrder = [...visibleIds, ...selectable.filter((id) => !visible.has(id))];
  const current = new Set(currentIds.filter((id) => allowed.has(id)));
  const prunedIds = scopedOrder.filter((id) => current.has(id));
  const stableAnchor = anchorId && visible.has(anchorId) ? anchorId : null;

  if (!visible.has(clickedId)) return { selectedIds: prunedIds, anchorId: stableAnchor };

  const toggle = Boolean(modifiers.metaKey || modifiers.ctrlKey);
  if (modifiers.shiftKey) {
    const anchorIndex = stableAnchor === null ? -1 : visibleIds.indexOf(stableAnchor);
    const clickedIndex = visibleIds.indexOf(clickedId);
    const start = anchorIndex < 0 ? clickedIndex : anchorIndex;
    const range = new Set(visibleIds.slice(Math.min(start, clickedIndex), Math.max(start, clickedIndex) + 1));
    return {
      selectedIds: scopedOrder.filter((id) => {
        if (!visible.has(id)) return current.has(id);
        return toggle ? current.has(id) || range.has(id) : range.has(id);
      }),
      anchorId: stableAnchor ?? clickedId,
    };
  }

  if (!toggle) return { selectedIds: [clickedId], anchorId: clickedId };

  const next = new Set(current);
  if (next.has(clickedId)) next.delete(clickedId);
  else next.add(clickedId);
  return { selectedIds: scopedOrder.filter((id) => next.has(id)), anchorId: clickedId };
}

/** Resolve bulk-action targets while retaining selected IDs hidden from the current view. */
export function resolveActionIds(
  orderedIds: readonly string[],
  currentIds: readonly string[],
  clickedId: string,
  selectableIds: readonly string[] = orderedIds,
): string[] {
  const selectable = new Set(selectableIds);
  const visibleIds = Array.from(new Set(orderedIds)).filter((id) => selectable.has(id));
  const selected = new Set(currentIds.filter((id) => selectable.has(id)));
  if (!selectable.has(clickedId) || !visibleIds.includes(clickedId)) return [];
  if (!selected.has(clickedId)) return [clickedId];

  const visible = new Set(visibleIds);
  const visibleSelected = visibleIds.filter((id) => selected.has(id));
  const hiddenSelected = selectableIds.filter((id) => !visible.has(id) && selected.has(id));
  return Array.from(new Set([...visibleSelected, ...hiddenSelected]));
}
