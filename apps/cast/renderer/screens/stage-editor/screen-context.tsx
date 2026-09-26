import { useCallback, useMemo, type ReactNode } from 'react';
import { useStageEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useEditorLeftPanelNav } from '../../features/workbench/use-editor-left-panel-nav';
import { createScreenContext } from '../../contexts/create-screen-context';

interface StageEditorScreenContextValue {
  state: {
    stages: ReturnType<typeof useStageEditor>['stages'];
    currentStageId: ReturnType<typeof useStageEditor>['currentStageId'];
    hasPendingChanges: boolean;
    isPushingChanges: boolean;
  };
  actions: {
    selectStage: (id: string | null) => void;
    createStage: () => Promise<string | null>;
    saveChanges: () => Promise<void>;
  };
}

const [StageEditorScreenContextProvider, useStageEditorScreen] = createScreenContext<StageEditorScreenContextValue>('StageEditorScreenContext');

export function StageEditorScreenProvider({ children }: { children: ReactNode }) {
  const { stages, currentStageId, setCurrentStageId, createStage, hasPendingChanges, isPushingChanges, pushChanges } = useStageEditor();
  const { commitProgramScene } = useRenderScenes();

  const handleSaveChanges = useCallback(async () => {
    if (!hasPendingChanges) return;
    await pushChanges();
    commitProgramScene();
  }, [commitProgramScene, hasPendingChanges, pushChanges]);

  useEditorLeftPanelNav({
    items: stages,
    currentId: currentStageId,
    activate: (id) => setCurrentStageId(id),
  });

  const value = useMemo<StageEditorScreenContextValue>(() => ({
    state: {
      stages,
      currentStageId,
      hasPendingChanges,
      isPushingChanges,
    },
    actions: {
      selectStage: setCurrentStageId,
      createStage,
      saveChanges: handleSaveChanges,
    },
  }), [createStage, currentStageId, handleSaveChanges, hasPendingChanges, isPushingChanges, setCurrentStageId, stages]);

  return <StageEditorScreenContextProvider value={value}>{children}</StageEditorScreenContextProvider>;
}

export { useStageEditorScreen };
