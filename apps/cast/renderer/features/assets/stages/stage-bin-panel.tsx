import { useMemo } from 'react';
import { XCircle } from 'lucide-react';
import type { Stage } from '@lumacast/composition';
import { useConfirm } from '@lumacast/ui';
import { useStagePlayback } from '../../../contexts/playback/playback-context';
import { useStageEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useWorkbench } from '../../../contexts/workbench-context';
import { useProjectContent } from '../../../contexts/use-project-content';
import { useMultiSelection } from '@lumacast/selection';
import { filterByText } from '../../../utils/filter-by-text';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { IconGroup } from '@renderer/components/icon-group';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { StageCard } from './stage-card';
import { runSelectionActions, useMultiSelectionKeyHandler } from '@lumacast/selection';

export function StageBinPanel() {
  const { stages: allStages } = useProjectContent();
  const { currentStageId, setCurrentStageId } = useStagePlayback();
  const { setCurrentStageId: setEditorStageId, deleteStage, duplicateStage } = useStageEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const { state: { searchValue, viewMode, grid } } = useBinControls();
  const confirm = useConfirm();
  const gridSize = grid?.value ?? 3;

  const stages = useMemo(
    () => filterByText(allStages, searchValue, (stage: Stage) => [stage.name]),
    [allStages, searchValue],
  );
  const orderedIds = stages.map((stage) => stage.id);
  const selection = useMultiSelection(orderedIds, 'stages');
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  function handleSelectionClick(id: string, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) {
    selection.select(id, modifiers);
    return Boolean(modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey);
  }

  function handleContextMenuTarget(id: string) {
    if (!selection.selectedIds.has(id)) selection.select(id);
  }

  async function handleDeleteResource(clickedId: string) {
    const ids = selection.actionIds(clickedId);
    if (ids.length === 0) return;
    const nameById = new Map(stages.map((stage) => [stage.id, stage.name]));
    const ok = await confirm({
      title: ids.length === 1 ? `Delete "${nameById.get(ids[0]) ?? 'stage'}"?` : `Delete ${ids.length} stages?`,
      description: ids.length === 1
        ? 'This stage layout will be permanently removed.'
        : 'These stage layouts will be permanently removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) await runSelectionActions(ids, (id) => deleteStage(id));
  }

  function handleDuplicateResource(clickedId: string) {
    void runSelectionActions(selection.actionIds(clickedId), (id) => duplicateStage(id));
  }

  return (
    <BinShell>
      <IconGroup.Root fill className="rounded-none">
        <IconGroup.Item
          active={Boolean(currentStageId)}
          aria-label="Clear stage"
          title="Clear stage"
          onClick={() => setCurrentStageId(null)}
        >
          <XCircle className="size-4" />
        </IconGroup.Item>
      </IconGroup.Root>
      <BinShell.Content data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode} virtualize>
          {stages.map((stage) => (
            <StageCard
              key={stage.id}
              stage={stage}
              isActive={stage.id === currentStageId}
              isResourceSelected={selection.selectedIds.has(stage.id)}
              onActivate={setCurrentStageId}
              onSelectionClick={handleSelectionClick}
              onContextMenuTarget={handleContextMenuTarget}
              onDeleteResource={handleDeleteResource}
              onDuplicateResource={handleDuplicateResource}
              onEdit={(id) => {
                setEditorStageId(id);
                setCurrentStageId(id);
                setWorkbenchMode('stage-editor');
              }}
            />
          ))}
        </BinPanelLayout>
      </BinShell.Content>
    </BinShell>
  );
}
