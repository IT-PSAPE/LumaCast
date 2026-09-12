import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Id } from '@lumacast/kernel';

interface SlideRangeSelection {
  selectedSlideIds: ReadonlySet<Id>;
  selectSlide: (index: number, extendRange: boolean) => void;
  actionSlideIds: (clickedSlideId: Id) => Id[];
}

export function useSlideRangeSelection(
  orderedSlideIds: Id[],
  activeIndex: number,
  scopeKey: string | null,
): SlideRangeSelection {
  const [selection, setSelection] = useState<Id[]>([]);
  const anchorIdRef = useRef<Id | null>(null);
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
      anchorIdRef.current = activeId;
      setSelection(activeId ? [activeId] : []);
      return;
    }

    const available = new Set(orderedSlideIds);
    setSelection((current) => {
      const next = current.filter((id) => available.has(id));
      return next.length === current.length ? current : next;
    });
    if (anchorIdRef.current && !available.has(anchorIdRef.current)) {
      anchorIdRef.current = activeId;
    }
  }, [activeId, orderedSlideIds, scopeKey]);

  const selectSlide = useCallback((index: number, extendRange: boolean) => {
    const clickedId = orderedSlideIds[index];
    if (!clickedId) return;

    if (!extendRange) {
      anchorIdRef.current = clickedId;
      setSelection([clickedId]);
      return;
    }

    const anchorIndex = anchorIdRef.current ? orderedSlideIds.indexOf(anchorIdRef.current) : -1;
    const resolvedAnchorIndex = anchorIndex >= 0
      ? anchorIndex
      : activeIndex >= 0 && activeIndex < orderedSlideIds.length
        ? activeIndex
        : index;
    if (anchorIndex < 0) anchorIdRef.current = orderedSlideIds[resolvedAnchorIndex] ?? clickedId;
    const start = Math.min(resolvedAnchorIndex, index);
    const end = Math.max(resolvedAnchorIndex, index);
    setSelection(orderedSlideIds.slice(start, end + 1));
  }, [activeIndex, orderedSlideIds]);

  const selectedSlideIds = useMemo(() => new Set(selection), [selection]);

  const actionSlideIds = useCallback((clickedSlideId: Id) => {
    if (!selectedSlideIds.has(clickedSlideId)) return [clickedSlideId];
    return orderedSlideIds.filter((id) => selectedSlideIds.has(id));
  }, [orderedSlideIds, selectedSlideIds]);

  return { selectedSlideIds, selectSlide, actionSlideIds };
}
