import { useCallback, useMemo, useRef } from 'react';
import type { MediaAsset } from '@core/types';
import { useElements, useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useActiveEditorSource } from '../../contexts/canvas/use-active-editor-source';
import { useWorkbench } from '../../contexts/workbench-context';
import { mapViewportPointToScene, type SceneViewportTransform } from './use-scene-stage-viewport';

interface StageViewportControllerActions {
  handleDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  handleViewportChange: (viewport: SceneViewportTransform) => void;
}

interface StageViewportControllerState {
  editable: boolean;
  scene: ReturnType<typeof useRenderScenes>['editScene'];
}

interface StageViewportController {
  actions: StageViewportControllerActions;
  state: StageViewportControllerState;
}

function parseDraggedMedia(raw: string): MediaAsset | null {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as MediaAsset;
  } catch {
    return null;
  }
}

export function useStageViewportController(): StageViewportController {
  const activeEditorSource = useActiveEditorSource();
  // Reaches the shared workbench context directly (not through the inspector
  // feature's useInspector() facade) so the canvas feature never depends on
  // the inspector feature — see inspector-context.tsx for the reasoning.
  const { actions: { setInspectorTab } } = useWorkbench();
  const { editScene, showScene } = useRenderScenes();
  const { createFromMedia } = useElements();
  const editable = activeEditorSource.editable;
  const scene = editable ? editScene : showScene;
  const viewportRef = useRef<SceneViewportTransform>({
    viewportWidth: scene.width,
    viewportHeight: scene.height,
    sceneScale: 1,
    sceneOffsetX: 0,
    sceneOffsetY: 0,
    sceneWidth: scene.width,
    sceneHeight: scene.height
  });

  const state = useMemo<StageViewportControllerState>(() => ({
    editable,
    scene
  }), [editable, scene]);

  const handleViewportChange = useCallback((viewport: SceneViewportTransform) => {
    viewportRef.current = viewport;
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!editable) return;
    event.preventDefault();
  }, [editable]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!editable) return;
    event.preventDefault();

    const media = parseDraggedMedia(event.dataTransfer.getData('application/x-cast-media'));
    if (!media) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const point = mapViewportPointToScene(event.clientX, event.clientY, rect, viewportRef.current);
    void createFromMedia(media, point.x, point.y);
    setInspectorTab('shape');
  }, [createFromMedia, editable, setInspectorTab]);

  return {
    actions: {
      handleDragOver,
      handleDrop,
      handleViewportChange
    },
    state
  };
}
