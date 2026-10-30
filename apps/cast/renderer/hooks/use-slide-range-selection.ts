import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Id } from '@lumacast/kernel';
import { resolveActionIds, resolveSelection } from '@lumacast/selection';

interface SlideRangeSelection {
  selectedSlideIds: ReadonlySet<Id>;
  selectSlide: (index: number, extendRange: boolean, toggleSelection?: boolean) => void;
  selectAll: (selectableSlideIds?: readonly Id[]) => void;
  clearSelection: () => void;
  actionSlideIds: (clickedSlideId: Id) => Id[];
}

export function useSlideRangeSelection(
  orderedSlideIds: Id[],
  activeIndex: number,
  scopeKey: string | null,
): SlideRangeSelection {
  const [selection, setSelection] = useState<Id[]>(() => {
    const activeId = orderedSlideIds[activeIndex];
    return activeId ? [activeId] : [];
  });
  const anchorIdRef = useRef<Id | null>(orderedSlideIds[activeIndex] ?? null);
  const previousScopeRef = useRef<string | null>(scopeKey);
  const previousActiveIdRef = useRef<Id | null>(orderedSlideIds[activeIndex] ?? null);

  const activeId = orderedSlideIds[activeIndex] ?? null;

  useEffect(() => {
    if (previousScopeRef.current !== scopeKey) {
      previousScopeRef.current = scopeKey;
      previousActiveIdRef.current = activeId;
      anchorIdRef.current = activeId;
      setSelection(activeId ? [activeId] : []);
      return;
    }

    if (previousActiveIdRef.current !== activeId) {
      previousActiveIdRef.current = activeId;
      // The active slide is a separate editor identity from the selected
      // group. Reorder persistence may temporarily move focus through several
      // selected slides; retain an explicit group selection in that case.
      anchorIdRef.current = activeId;
      setSelection((current) => current.length > 1 ? current : activeId ? [activeId] : []);
    }

    const available = new Set(orderedSlideIds);
    setSelection((current) => {
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
    if (anchorIdRef.current && !available.has(anchorIdRef.current)) {
      anchorIdRef.current = activeId;
    }
  }, [activeId, orderedSlideIds, scopeKey, selection]);

  const selectSlide = useCallback((index: number, extendRange: boolean, toggleSelection = false) => {
    const clickedId = orderedSlideIds[index];
    if (!clickedId) return;
    const available = new Set(orderedSlideIds);
    const currentAnchor = anchorIdRef.current && available.has(anchorIdRef.current)
      ? anchorIdRef.current
      : activeIndex >= 0 && activeIndex < orderedSlideIds.length
        ? orderedSlideIds[activeIndex]
        : clickedId;
    const resolvedAnchor = extendRange ? currentAnchor : clickedId;
    anchorIdRef.current = resolvedAnchor;
    setSelection((current) => resolveSelection(
        orderedSlideIds,
        current,
        resolvedAnchor,
        clickedId,
        { shiftKey: extendRange, ctrlKey: toggleSelection },
      ).selectedIds);
  }, [activeIndex, orderedSlideIds]);

  const selectedSlideIds = useMemo(() => new Set(selection), [selection]);

  const selectAll = useCallback((selectableSlideIds: readonly Id[] = orderedSlideIds) => {
    const selectable = new Set(selectableSlideIds);
    const next = orderedSlideIds.filter((id) => selectable.has(id));
    anchorIdRef.current = next[0] ?? activeId;
    setSelection(next);
  }, [activeId, orderedSlideIds]);

  const clearSelection = useCallback(() => {
    anchorIdRef.current = activeId;
    setSelection([]);
  }, [activeId]);

  const actionSlideIds = useCallback((clickedSlideId: Id) => {
    return resolveActionIds(orderedSlideIds, selection, clickedSlideId);
  }, [orderedSlideIds, selection]);

  return { selectedSlideIds, selectSlide, selectAll, clearSelection, actionSlideIds };
}
