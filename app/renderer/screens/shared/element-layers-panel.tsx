import { useCallback } from 'react';
import type { SlideElement } from '@lumacast/composition';
import { EmptyState } from '@renderer/components/display/empty-state';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { SortableLayerRow } from './sortable-layer-row';

const elementId = (element: SlideElement) => element.id;

export function ElementLayersPanel({ emptyMessage }: { emptyMessage: string }) {
  const { effectiveElements, selectedElementId, selectElement, reorderElements, renameElement, toggleElementVisibility, toggleElementLock } = useElements();
  const { setInspectorTab } = useInspector();

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
  });

  function handleSelect(element: SlideElement) {
    selectElement(element.id);
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
      <div data-ui-region="object-list-panel" className="flex w-full flex-col gap-1.5">
        {orderedElements.map((element) => (
          <SortableLayerRow
            key={element.id}
            element={element}
            isSelected={element.id === selectedElementId}
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
