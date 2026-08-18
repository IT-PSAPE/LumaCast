import { useCallback, useMemo, useRef } from 'react';
import type { MediaAsset, RenderScene } from '@lumacast/composition';
import type { ActiveEditorSource } from './editor-source';
import { mapViewportPointToScene, type SceneViewportTransform } from './use-scene-stage-viewport';

interface StageViewportControllerActions {
  handleDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  handleDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  handleViewportChange: (viewport: SceneViewportTransform) => void;
}

interface StageViewportControllerState {
  editable: boolean;
  scene: RenderScene;
}

interface StageViewportController {
  actions: StageViewportControllerActions;
  state: StageViewportControllerState;
}

// The narrow slice of app-shell state this controller needs. The app (its
// stage-viewport.tsx caller) resolves the active editor source, the
// workbench's inspector-tab setter, the two candidate scenes, and the
// element-creation action, then passes them in — the package never reaches
// into an app-shell context directly.
export interface StageViewportControllerDeps {
  activeEditorSource: ActiveEditorSource;
  setInspectorTab: (tab: 'shape') => void;
  editScene: RenderScene;
  showScene: RenderScene;
  createFromMedia: (asset: MediaAsset, x: number, y: number) => Promise<void>;
}

function parseDraggedMedia(raw: string): MediaAsset | null {
  if (!raw) return null;

  try {
    return JSON.parse(raw) as MediaAsset;
  } catch {
    return null;
  }
}

export function useStageViewportController({
  activeEditorSource,
  setInspectorTab,
  editScene,
  showScene,
  createFromMedia,
}: StageViewportControllerDeps): StageViewportController {
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
