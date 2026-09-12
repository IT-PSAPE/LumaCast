import { useCallback } from 'react';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { useStageEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useStageEditorScreen } from './screen-context';
import { StageListItem } from './stage-list-item';

const stageId = (stage: ReturnType<typeof useStageEditorScreen>['state']['stages'][number]) => stage.id;

export function StageList() {
  const { state } = useStageEditorScreen();
  const { reorderStage } = useStageEditor();

  const commitReorder = useCallback(
    // Unguarded: a rejection is what reverts the optimistic order.
    ({ id, toIndex }: SortableOrderCommit) => reorderStage(id, toIndex),
    [reorderStage],
  );

  const { items: stages, dnd } = useSortableOrder({
    items: state.stages,
    getId: stageId,
    commit: commitReorder,
  });

  return (
    <SortableList.Root {...dnd}>
      <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label="Stages">
        {stages.map((stage, index) => (
          <StageListItem key={stage.id} stage={stage} index={index} isActive={state.currentStageId === stage.id} />
        ))}
      </div>
    </SortableList.Root>
  );
}
