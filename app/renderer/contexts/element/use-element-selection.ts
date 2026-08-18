import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';

interface UseElementSelectionInput {
  effectiveElements: SlideElement[];
}

function hasSameIds(a: Id[], b: Id[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function filterAllowedSelection(current: Id[], allowed: Set<Id>): Id[] {
  const filtered = current.filter((id) => allowed.has(id));
  if (hasSameIds(current, filtered)) return current;
  return filtered;
}

function dedupeIds(ids: Id[]): Id[] {
  return Array.from(new Set(ids));
}

export function useElementSelection({ effectiveElements }: UseElementSelectionInput) {
  const [selectedElementIds, setSelectedElementIds] = useState<Id[]>([]);

  useEffect(() => {
    const allowed = new Set(effectiveElements.map((element) => element.id));
    setSelectedElementIds((current) => filterAllowedSelection(current, allowed));
  }, [effectiveElements]);

  const primarySelectedElementId = selectedElementIds[0] ?? null;

  const selectedElement = useMemo(() => {
    if (!primarySelectedElementId) return null;
    return effectiveElements.find((element) => element.id === primarySelectedElementId) ?? null;
  }, [effectiveElements, primarySelectedElementId]);

  const selectElement = useCallback((id: Id | null) => {
    setSelectedElementIds(id ? [id] : []);
  }, []);

  const selectElements = useCallback((ids: Id[]) => {
    setSelectedElementIds((current) => {
      const next = dedupeIds(ids);
      if (hasSameIds(current, next)) return current;
      return next;
    });
  }, []);

  const toggleElementSelection = useCallback((id: Id) => {
    setSelectedElementIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [id, ...current];
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedElementIds([]);
  }, []);

  return {
    selectedElementIds,
    primarySelectedElementId,
    selectedElement,
    setSelectedElementIds,
    selectElement,
    selectElements,
    toggleElementSelection,
    clearSelection,
  };
}
