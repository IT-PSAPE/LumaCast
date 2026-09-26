import { useCallback, useMemo, type ReactNode } from 'react';
import { useOverlayEditor } from '../../contexts/asset-editor/asset-editor-context';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useEditorLeftPanelNav } from '../../features/workbench/use-editor-left-panel-nav';
import { createScreenContext } from '../../contexts/create-screen-context';

interface OverlayEditorScreenContextValue {
  state: {
    overlays: ReturnType<typeof useOverlayEditor>['overlays'];
    currentOverlayId: ReturnType<typeof useOverlayEditor>['currentOverlayId'];
    hasPendingChanges: boolean;
    isPushingChanges: boolean;
  };
  actions: {
    selectOverlay: (id: string | null) => void;
    createOverlay: () => Promise<void>;
    saveChanges: () => Promise<void>;
  };
}

const [OverlayEditorScreenContextProvider, useOverlayEditorScreen] = createScreenContext<OverlayEditorScreenContextValue>('OverlayEditorScreenContext');

export function OverlayEditorScreenProvider({ children }: { children: ReactNode }) {
  const { overlays, currentOverlayId, setCurrentOverlayId, createOverlay, hasPendingChanges, isPushingChanges, pushChanges } = useOverlayEditor();
  const { commitProgramScene } = useRenderScenes();

  const handleSaveChanges = useCallback(async () => {
    if (!hasPendingChanges) return;
    await pushChanges();
    commitProgramScene();
  }, [commitProgramScene, hasPendingChanges, pushChanges]);

  useEditorLeftPanelNav({
    items: overlays,
    currentId: currentOverlayId,
    activate: (id) => setCurrentOverlayId(id),
  });

  const value = useMemo<OverlayEditorScreenContextValue>(() => ({
    state: {
      overlays,
      currentOverlayId,
      hasPendingChanges,
      isPushingChanges,
    },
    actions: {
      selectOverlay: setCurrentOverlayId,
      createOverlay,
      saveChanges: handleSaveChanges,
    },
  }), [createOverlay, currentOverlayId, handleSaveChanges, hasPendingChanges, isPushingChanges, overlays, setCurrentOverlayId]);

  return <OverlayEditorScreenContextProvider value={value}>{children}</OverlayEditorScreenContextProvider>;
}

export { useOverlayEditorScreen };
