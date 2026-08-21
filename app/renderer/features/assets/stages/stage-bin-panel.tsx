import { useMemo } from 'react';
import type { Stage } from '@lumacast/composition';
import { useStagePlayback } from '../../../contexts/playback/playback-context';
import { useStageEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useWorkbench } from '../../../contexts/workbench-context';
import { useProjectContent } from '../../../contexts/use-project-content';
import { filterByText } from '../../../utils/filter-by-text';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { StageCard } from './stage-card';

export function StageBinPanel() {
  const { stages: allStages } = useProjectContent();
  const { currentStageId, setCurrentStageId } = useStagePlayback();
  const { setCurrentStageId: setEditorStageId } = useStageEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const { state: { searchValue, viewMode, grid } } = useBinControls();
  const gridSize = grid?.value ?? 3;

  const stages = useMemo(
    () => filterByText(allStages, searchValue, (stage: Stage) => [stage.name]),
    [allStages, searchValue],
  );

  return (
    <BinShell>
      <BinShell.Content>
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
          {stages.map((stage, index) => (
            <StageCard
              key={stage.id}
              stage={stage}
              index={index}
              isActive={stage.id === currentStageId}
              onActivate={setCurrentStageId}
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
