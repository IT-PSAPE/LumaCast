import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Id } from '@lumacast/kernel';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { commitSelectedReorder } from '@lumacast/selection';
import { useOverlayEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useMultiSelection, useMultiSelectionKeyHandler, type SelectionModifiers } from '@lumacast/selection';
import { useOverlayEditorScreen } from './screen-context';
import { OverlayListItem } from './overlay-list-item';

const overlayId = (overlay: ReturnType<typeof useOverlayEditorScreen>['state']['overlays'][number]) => overlay.id;

export function OverlayList() {
  const { state, actions } = useOverlayEditorScreen();
  const { reorderOverlay } = useOverlayEditor();
  const selection = useMultiSelection(state.overlays.map(overlayId), 'overlay-editor');
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  const commitReorder = useCallback(
    // Unguarded: a rejection is what reverts the optimistic order.
    (change: SortableOrderCommit) => commitSelectedReorder(change, reorderOverlay),
    [reorderOverlay],
  );

  const { items: overlays, dnd } = useSortableOrder({
    items: state.overlays,
    getId: overlayId,
    commit: commitReorder,
    selectedIds: selection.selectedIds,
  });

  const handleSelect = useCallback((id: Id, event: ReactMouseEvent<HTMLElement>) => {
    const modifiers: SelectionModifiers = {
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    };
    selection.select(id, modifiers);
    if (!modifiers.shiftKey && !modifiers.metaKey && !modifiers.ctrlKey) actions.selectOverlay(id);
  }, [actions, selection.select]);

  const handleContextMenu = useCallback((id: Id, event: ReactMouseEvent<HTMLElement>) => {
    const modifiers: SelectionModifiers = {
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    };
    if (modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey) {
      selection.select(id, modifiers);
    } else if (!selection.selectedIds.has(id)) {
      selection.select(id);
      actions.selectOverlay(id);
    }
  }, [actions, selection.select, selection.selectedIds]);

  return (
    <SortableList.Root {...dnd}>
      <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label="Library overlays" data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        {overlays.map((overlay) => (
          <OverlayListItem
            key={overlay.id}
            overlay={overlay}
            isActive={state.currentOverlayId === overlay.id}
            selection={selection}
            onSelect={(event) => handleSelect(overlay.id, event)}
            onContextMenu={(event) => handleContextMenu(overlay.id, event)}
          />
        ))}
      </div>
    </SortableList.Root>
  );
}
