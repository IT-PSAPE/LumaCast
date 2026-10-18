import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { closeProjectorWindow, createProjectorWindowSession, openCanvasProjector } from '../../projector-window';
import { multiviewTileCapacityFor, openMultiviewWindow, type MultiviewWindowControl } from '../../multiview-window';
import { getRenderedSourceIds } from '../../scene-render-scope';
import type { StreamProject, StreamSource } from '../../../shared/desktop-api';
import { friendlyError } from '../shared/friendly-error';

export interface UseMultiviewParams {
  project: StreamProject | null;
  projectRef: RefObject<StreamProject | null>;
  allSourcesRef: RefObject<StreamSource[]>;
  activeSourceIdsRef: RefObject<Set<string>>;
  runtimes: RefObject<Map<string, MediaStream>>;
  stopRuntime: (sourceId: string) => void;
  previewCanvasRef: RefObject<HTMLCanvasElement | null>;
  programCanvasRef: RefObject<HTMLCanvasElement | null>;
  chooseScene: (sceneId: string) => void;
  transitionToScene: (sceneId: string) => void;
  setActionError: (message: string) => void;
  /**
   * Owned by App.tsx (not this hook) because the `activeSourceIds` memo feeding
   * `useCapture` needs this value before `useCapture`'s result (`runtimes`,
   * `stopRuntime`) is available to construct this hook.
   */
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
    project, projectRef, allSourcesRef, activeSourceIdsRef, runtimes, stopRuntime,
    previewCanvasRef, programCanvasRef, chooseScene, transitionToScene, setActionError,
    multiviewWindowOpen, setMultiviewWindowOpen,
  } = params;

  const projectorSessionsRef = useRef<{ preview: ReturnType<typeof createProjectorWindowSession>; program: ReturnType<typeof createProjectorWindowSession> } | null>(null);
  projectorSessionsRef.current ??= { preview: createProjectorWindowSession(), program: createProjectorWindowSession() };
  const projectorSessions = projectorSessionsRef.current;
  const multiviewRuntimeBaseline = useRef<Set<string> | null>(null);
  const multiviewWindowRef = useRef<MultiviewWindowControl | null>(null);
  const multiviewCanvasesRef = useRef(new Map<string, HTMLCanvasElement>());

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
    if (!canvas || !project || (kind === 'preview' && !project.studioMode)) {
      setActionError(`The ${kind} output is not ready.`);
      return;
    }
    setActionError('');
    openCanvasProjector(kind, canvas, project.output.frameRate, projectorSessions[kind], setActionError);
  };

  // Attaches (or tears back down) the runtime sources needed to render every
  // scene at once while the Multiview window is open — the same scope widening
  // the in-stage multiview toggle used to perform. Reads `projectRef` (not the
  // render-scoped `project`) so the popup's long-lived `onClosed` handler always
  // sees current state, not whatever was captured when the window was opened.
  const setMultiviewRuntimeScope = (active: boolean) => {
    const current = projectRef.current;
    if (!current) return;
    if (active) {
      activeSourceIdsRef.current = getRenderedSourceIds(current.scenes, current.activeSceneId, current.liveSceneId, true);
      multiviewRuntimeBaseline.current = new Set(runtimes.current.keys());
      return;
    }
    const stillRendered = getRenderedSourceIds(current.scenes, current.activeSceneId, current.liveSceneId, false);
    activeSourceIdsRef.current = stillRendered;
    const baseline = multiviewRuntimeBaseline.current;
    for (const sourceId of runtimes.current.keys()) {
      const source = allSourcesRef.current.find((item) => item.id === sourceId);
      if (baseline?.has(sourceId) || stillRendered.has(sourceId) || (source?.kind !== 'camera' && source?.kind !== 'microphone' && source?.kind !== 'desktop-audio' && source?.kind !== 'application-audio')) continue;
      stopRuntime(sourceId);
    }
    multiviewRuntimeBaseline.current = null;
  };

  const closeMultiview = () => {
    multiviewWindowRef.current?.close();
    multiviewWindowRef.current = null;
    setMultiviewRuntimeScope(false);
    setMultiviewWindowOpen(false);
  };

  const openMultiview = () => {
    if (!project || multiviewWindowRef.current?.isOpen()) return;
    setActionError('');
    setMultiviewRuntimeScope(true);
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
            isProgram: scene.id === projectRef.current?.liveSceneId,
          })),
        },
        {
          onSelectScene: (sceneId) => chooseSceneRef.current(sceneId),
          onTransitionToScene: (sceneId) => transitionToSceneRef.current(sceneId),
          onClosed: () => {
            multiviewWindowRef.current = null;
            setMultiviewRuntimeScope(false);
            setMultiviewWindowOpen(false);
          },
        },
        { maxScenes: multiviewTileCapacityFor(project.scenes.length) },
      );
      multiviewWindowRef.current = control;
      setMultiviewWindowOpen(true);
    } catch (error) {
      setMultiviewRuntimeScope(false);
      setActionError(`The multiview window could not be opened: ${friendlyError(error)}`);
    }
  };

  const toggleMultiviewWindow = () => {
    if (multiviewWindowOpen) closeMultiview();
    else openMultiview();
  };

  return { multiviewCanvasesRef, openProjector, openMultiview, closeMultiview, toggleMultiviewWindow };
}
