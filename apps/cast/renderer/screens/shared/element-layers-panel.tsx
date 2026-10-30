import { useCallback, useMemo, useRef } from 'react';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import { EmptyState } from '@lumacast/ui';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { SortableLayerRow } from './sortable-layer-row';
import type { SelectionModifiers } from '@lumacast/selection';

const elementId = (element: SlideElement) => element.id;

export function ElementLayersPanel({ emptyMessage }: { emptyMessage: string }) {
  const { effectiveElements, selectedElementIds, selectElement, selectElements, clearSelection, reorderElements, renameElement, toggleElementVisibility, toggleElementLock } = useElements();
  const { setInspectorTab } = useInspector();
  const anchorRef = useRef<Id | null>(null);
  const selectedIds = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);

  // Top of the list is front-most (highest layer, then highest zIndex), so the
  // panel order is the reverse of the paint order `reorderElements` takes.
  const frontToBack = effectiveElements.slice().reverse();

  const commitReorder = useCallback(
    // Not guarded with .catch here (unlike the one-shot element ops): a
    // reorderElements rejection — #214, an element deleted mid-drag — is what
    // tells useSortableOrder to put the row back.
    ({ orderedIds }: SortableOrderCommit) => reorderElements(orderedIds.slice().reverse()),
    [reorderElements],
  );

  const { items: orderedElements, dnd } = useSortableOrder({
    items: frontToBack,
    getId: elementId,
    commit: commitReorder,
    selectedIds,
  });

  function handleSelect(element: SlideElement, modifiers: SelectionModifiers) {
    const ids = orderedElements.map((item) => item.id);
    const toggle = modifiers.metaKey || modifiers.ctrlKey;
    if (modifiers.shiftKey) {
      const anchorId = anchorRef.current && ids.includes(anchorRef.current) ? anchorRef.current : selectedElementIds[0] ?? element.id;
      const anchorIndex = ids.indexOf(anchorId);
      const index = ids.indexOf(element.id);
      const range = ids.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1);
      selectElements(toggle ? Array.from(new Set([...selectedElementIds, ...range])) : range);
      anchorRef.current = anchorId;
    } else if (toggle) {
      selectElements(selectedIds.has(element.id) ? selectedElementIds.filter((id) => id !== element.id) : [...selectedElementIds, element.id]);
      anchorRef.current = element.id;
    } else {
      selectElement(element.id);
      anchorRef.current = element.id;
    }
    setInspectorTab(element.type === 'text' ? 'text' : element.type === 'video' ? 'video' : 'shape');
  }

  if (orderedElements.length === 0) {
    return (
      <EmptyState.Root data-ui-region="object-list-panel">
        <EmptyState.Title>{emptyMessage}</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  return (
    <SortableList.Root {...dnd}>
      <div
        data-ui-region="object-list-panel"
        className="flex w-full flex-col gap-1.5"
        onKeyDown={(event) => {
          if (event.target instanceof HTMLInputElement) return;
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            event.stopPropagation();
            selectElements(orderedElements.map((element) => element.id));
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            clearSelection();
            anchorRef.current = null;
          }
        }}
      >
        {orderedElements.map((element) => (
          <SortableLayerRow
            key={element.id}
            element={element}
            isSelected={selectedIds.has(element.id)}
            onSelect={handleSelect}
            onRename={renameElement}
            onToggleVisibility={toggleElementVisibility}
            onToggleLock={toggleElementLock}
          />
        ))}
      </div>
    </SortableList.Root>
  );
}
