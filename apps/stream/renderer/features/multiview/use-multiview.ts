import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { closeProjectorWindow, createProjectorWindowSession, openCanvasProjector } from '../../projector-window';
import { multiviewTileCapacityFor, openMultiviewWindow, type MultiviewWindowControl } from '../../multiview-window';
import type { StreamProject } from '../../../shared/desktop-api';
import { friendlyError } from '../shared/friendly-error';

export interface UseMultiviewParams {
  project: StreamProject | null;
  projectRef: RefObject<StreamProject | null>;
  /** Actual on-air identity can differ from the draft after undo or deletion. */
  programSceneId: string | null;
  /** Frame rate of the committed Program canvas, which may differ from the draft. */
  programFrameRate: StreamProject['output']['frameRate'] | null;
  previewCanvasRef: RefObject<HTMLCanvasElement | null>;
  programCanvasRef: RefObject<HTMLCanvasElement | null>;
  chooseScene: (sceneId: string) => void;
  transitionToScene: (sceneId: string) => void;
  setActionError: (message: string) => void;
  /** App includes popup scene canvases in the shared capture/render scope. */
  multiviewWindowOpen: boolean;
  setMultiviewWindowOpen: Dispatch<SetStateAction<boolean>>;
}

export interface UseMultiviewResult {
  multiviewCanvasesRef: RefObject<Map<string, HTMLCanvasElement>>;
  openProjector: (kind: 'preview' | 'program') => void;
  openMultiview: () => void;
  closeMultiview: () => void;
  toggleMultiviewWindow: () => void;
}

/**
 * The Multiview window (its off-screen per-scene canvases and the runtime
 * scope widening it requires) and the Preview/Program projector windows.
 * Mirrors the former inline App.tsx implementation exactly.
 */
export function useMultiview(params: UseMultiviewParams): UseMultiviewResult {
  const {
    project, projectRef, programSceneId, programFrameRate,
    previewCanvasRef, programCanvasRef, chooseScene, transitionToScene, setActionError,
    multiviewWindowOpen, setMultiviewWindowOpen,
  } = params;

  const projectorSessionsRef = useRef<{ preview: ReturnType<typeof createProjectorWindowSession>; program: ReturnType<typeof createProjectorWindowSession> } | null>(null);
  projectorSessionsRef.current ??= { preview: createProjectorWindowSession(), program: createProjectorWindowSession() };
  const projectorSessions = projectorSessionsRef.current;
  const multiviewWindowRef = useRef<MultiviewWindowControl | null>(null);
  const multiviewCanvasesRef = useRef(new Map<string, HTMLCanvasElement>());
  const programSceneIdRef = useRef(programSceneId);
  programSceneIdRef.current = programSceneId;

  // Keeps `openMultiview`'s handlers (captured once, for the life of the popup
  // window) from going stale: they call through these refs instead of closing
  // directly over a render's `chooseScene`/`transitionToScene`.
  const chooseSceneRef = useRef(chooseScene);
  chooseSceneRef.current = chooseScene;
  const transitionToSceneRef = useRef(transitionToScene);
  transitionToSceneRef.current = transitionToScene;

  useEffect(() => () => {
    closeProjectorWindow(projectorSessions.preview);
    closeProjectorWindow(projectorSessions.program);
    multiviewWindowRef.current?.close();
  }, []);

  useEffect(() => {
    if (project?.studioMode) return;
    closeProjectorWindow(projectorSessions.preview);
  }, [project?.studioMode]);

  const openProjector = (kind: 'preview' | 'program') => {
    const canvas = kind === 'preview' ? previewCanvasRef.current : programCanvasRef.current;
    const frameRate = kind === 'program' ? programFrameRate : project?.output.frameRate;
    if (!canvas || !project || frameRate == null || (kind === 'preview' && !project.studioMode)) {
      setActionError(`The ${kind} output is not ready.`);
      return;
    }
    setActionError('');
    openCanvasProjector(kind, canvas, frameRate, projectorSessions[kind], setActionError);
  };

  // App derives capture scope from popup/dock visibility. The capture owner
  // retains Program/outgoing resources independently of this window's lifetime.
  const closeMultiview = () => {
    multiviewWindowRef.current?.close();
    multiviewWindowRef.current = null;
    setMultiviewWindowOpen(false);
  };

  const openMultiview = () => {
    if (!project || multiviewWindowRef.current?.isOpen()) return;
    setActionError('');
    try {
      const control = openMultiviewWindow(
        {
          getCanvas: (kind, sceneId) => {
            if (kind === 'preview') return previewCanvasRef.current;
            if (kind === 'program') return programCanvasRef.current;
            if (kind === 'scene' && sceneId) return multiviewCanvasesRef.current.get(sceneId) ?? null;
            return null;
          },
          scenes: () => (projectRef.current?.scenes ?? []).map((scene) => ({
            id: scene.id,
            name: scene.name,
            isPreview: scene.id === projectRef.current?.activeSceneId,
            isProgram: scene.id === programSceneIdRef.current,
          })),
        },
        {
          onSelectScene: (sceneId) => chooseSceneRef.current(sceneId),
          onTransitionToScene: (sceneId) => transitionToSceneRef.current(sceneId),
          onClosed: () => {
            multiviewWindowRef.current = null;
            setMultiviewWindowOpen(false);
          },
        },
        { maxScenes: multiviewTileCapacityFor(project.scenes.length) },
      );
      multiviewWindowRef.current = control;
      setMultiviewWindowOpen(true);
    } catch (error) {
      setActionError(`The multiview window could not be opened: ${friendlyError(error)}`);
    }
  };

  const toggleMultiviewWindow = () => {
    if (multiviewWindowOpen) closeMultiview();
    else openMultiview();
  };

  return { multiviewCanvasesRef, openProjector, openMultiview, closeMultiview, toggleMultiviewWindow };
}
