import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { resolveActionIds, resolveSelection } from './selection';
import type { SelectionModifiers } from './selection';

interface SelectionState {
  scope: string | null;
  ids: string[];
  anchorId: string | null;
}

/** Transient collection selection, independent of the active editor or live item. */
export function useMultiSelection(orderedIds: string[], scopeKey: string | null, selectableIds: string[] = orderedIds) {
  const [selection, setSelection] = useState<SelectionState>({ scope: scopeKey, ids: [], anchorId: null });
  const scopedIds = useMemo(() => Array.from(new Set(selectableIds)), [selectableIds]);
  const available = useMemo(() => new Set(scopedIds), [scopedIds]);
  const visibleIds = useMemo(() => Array.from(new Set(orderedIds)).filter((id) => available.has(id)), [available, orderedIds]);
  const visible = useMemo(() => new Set(visibleIds), [visibleIds]);
  const scopedOrder = useMemo(() => [...visibleIds, ...scopedIds.filter((id) => !visible.has(id))], [scopedIds, visible, visibleIds]);
  const selectedIds = useMemo<ReadonlySet<string>>(() => new Set(
    selection.scope === scopeKey ? scopedOrder.filter((id) => selection.ids.includes(id)) : [],
  ), [scopeKey, scopedOrder, selection]);

  useEffect(() => {
    setSelection((current) => {
      if (current.scope !== scopeKey) return { scope: scopeKey, ids: [], anchorId: null };
      const ids = scopedOrder.filter((id) => current.ids.includes(id));
      const anchorId = current.anchorId && available.has(current.anchorId) ? current.anchorId : null;
      if (ids.length === current.ids.length && anchorId === current.anchorId) return current;
      return { scope: scopeKey, ids, anchorId };
    });
  }, [available, scopeKey, scopedOrder]);

  const select = useCallback((id: string, modifiers: SelectionModifiers = {}) => {
    if (!visible.has(id)) return;
    setSelection((previous) => {
      const current = previous.scope === scopeKey ? previous : { scope: scopeKey, ids: [], anchorId: null };
      const next = resolveSelection(visibleIds, current.ids, current.anchorId, id, modifiers, scopedIds);
      return { scope: scopeKey, ids: next.selectedIds, anchorId: next.anchorId };
    });
  }, [scopeKey, scopedIds, visible, visibleIds]);

  const actionIds = useCallback((clickedId: string): string[] => resolveActionIds(
    visibleIds,
    Array.from(selectedIds),
    clickedId,
    scopedIds,
  ), [scopedIds, selectedIds, visibleIds]);

  const clearSelection = useCallback(() => setSelection({ scope: scopeKey, ids: [], anchorId: null }), [scopeKey]);
  const selectAll = useCallback(() => setSelection((previous) => {
    const current = previous.scope === scopeKey ? previous.ids : [];
    const hidden = current.filter((id) => available.has(id) && !visible.has(id));
    const ids = [...visibleIds, ...hidden.filter((id) => !visible.has(id))];
    return { scope: scopeKey, ids, anchorId: visibleIds[0] ?? null };
  }), [available, scopeKey, visible, visibleIds]);

  return { selectedIds, select, actionIds, clearSelection, selectAll };
}

/** Keep collection selection shortcuts local and away from editable controls. */
export function useMultiSelectionKeyHandler({
  selectedCount,
  selectAll,
  clearSelection,
}: {
  selectedCount: number;
  selectAll: () => void;
  clearSelection: () => void;
}) {
  return useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && (
      target.isContentEditable
      || target.closest('input, textarea, select, [contenteditable="true"]')
    )) return;

    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      selectAll();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (selectedCount > 0) clearSelection();
    }
  }, [clearSelection, selectAll, selectedCount]);
}
