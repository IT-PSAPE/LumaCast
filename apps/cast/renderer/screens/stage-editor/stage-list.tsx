import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Id } from '@lumacast/kernel';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { commitSelectedReorder } from '@lumacast/selection';
import { useStageEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useMultiSelection, useMultiSelectionKeyHandler, type SelectionModifiers } from '@lumacast/selection';
import { useStageEditorScreen } from './screen-context';
import { StageListItem } from './stage-list-item';

const stageId = (stage: ReturnType<typeof useStageEditorScreen>['state']['stages'][number]) => stage.id;

export function StageList() {
  const { state, actions } = useStageEditorScreen();
  const { reorderStage } = useStageEditor();
  const selection = useMultiSelection(state.stages.map(stageId), 'stage-editor');
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  const commitReorder = useCallback(
    // Unguarded: a rejection is what reverts the optimistic order.
    (change: SortableOrderCommit) => commitSelectedReorder(change, reorderStage),
    [reorderStage],
  );

  const { items: stages, dnd } = useSortableOrder({
    items: state.stages,
    getId: stageId,
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
    if (!modifiers.shiftKey && !modifiers.metaKey && !modifiers.ctrlKey) actions.selectStage(id);
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
      actions.selectStage(id);
    }
  }, [actions, selection.select, selection.selectedIds]);

  return (
    <SortableList.Root {...dnd}>
      <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label="Stages" data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        {stages.map((stage) => (
          <StageListItem
            key={stage.id}
            stage={stage}
            isActive={state.currentStageId === stage.id}
            selection={selection}
            onSelect={(event) => handleSelect(stage.id, event)}
            onContextMenu={(event) => handleContextMenu(stage.id, event)}
          />
        ))}
      </div>
    </SortableList.Root>
  );
}
