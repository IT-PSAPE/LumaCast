import { useState, type Dispatch, type SetStateAction } from 'react';
import { createSceneTransition, type SceneTransition, type SceneTransitionType } from '../../scene-transition';
import { removeSourceVisibilityHotkeys } from '../../scene-hotkeys';
import { flattenSourceLeaves, flattenSourceNodes, removeSceneReferenceSources } from '../../../shared/source-tree';
import type { StreamProject, StreamScene } from '../../../shared/desktop-api';
import type { SceneRuntimeLease, SceneRuntimePort } from '../../shared/scene-runtime-port';
import { friendlyError } from '../../shared/friendly-error';
import { cloneSceneSource } from '../../shared/source-factory';

export interface UseScenesParams {
  project: StreamProject | null;
  setProjectValue: (update: (current: StreamProject) => StreamProject) => void;
  setActionError: (message: string) => void;
  working: boolean;
  setWorking: Dispatch<SetStateAction<boolean>>;
  selectSource: (sourceId: string | null) => void;

  /** Scoped Capture capability; Scenes does not inspect runtime storage or lifecycle details. */
  sceneRuntimePort: SceneRuntimePort;
  /** Current immutable Program root, used as the outgoing transition scene. */
  programSceneId?: string | null;
  /** Runtime-aware gate that also permits a same-scene config commit. */
  canTransition?: (sceneId: string) => boolean;
  /** Commits the draft target into Program; false means the action is stale or blocked. */
  commitProgram?: (sceneId: string) => boolean;
  /** Releases the retained outgoing Program snapshot after Cut or transition completion. */
  finishProgramTransition?: () => void;
}

export interface UseScenesResult {
  sceneDialog: 'rename' | 'delete' | null;
  setSceneDialog: Dispatch<SetStateAction<'rename' | 'delete' | null>>;
  sceneNameDraft: string;
  setSceneNameDraft: Dispatch<SetStateAction<string>>;
  transition: SceneTransition | null;
  transitionType: SceneTransitionType;
  setTransitionType: Dispatch<SetStateAction<SceneTransitionType>>;
  transitionColor: string;
  setTransitionColor: Dispatch<SetStateAction<string>>;
  transitionMs: number;
  setTransitionMs: Dispatch<SetStateAction<number>>;
  finishTransition: () => void;

  addScene: () => void;
  renameActiveScene: () => void;
  renameScene: (sceneId: string, name: string) => void;
  reorderScenes: (sceneIds: string[]) => void;
  duplicateActiveScene: (sceneId?: string) => Promise<void>;
  deleteActiveScene: () => void;
  deleteScenes: (sceneIds: string[]) => void;
  chooseScene: (sceneId: string) => void;
  transitionScene: (sceneId?: string) => void;
  toggleStudioMode: () => void;
  transitionToScene: (sceneId: string) => void;

  /** Clears any in-flight transition and open scene dialog — called when the active scene collection changes. */
  resetForWorkspaceChange: () => void;
}

/**
 * Scene list editing (add/rename/duplicate/delete/reorder), program/preview
 * switching (choose/transition), and Studio Mode. Mirrors the former
 * inline App.tsx implementation exactly.
 */
export function useScenes(params: UseScenesParams): UseScenesResult {
  const {
    project, setProjectValue, setActionError, working, setWorking, selectSource,
    sceneRuntimePort,
  } = params;

  const [sceneDialog, setSceneDialog] = useState<'rename' | 'delete' | null>(null);
  const [sceneNameDraft, setSceneNameDraft] = useState('');
  const [transition, setTransition] = useState<SceneTransition | null>(null);
  const [transitionType, setTransitionType] = useState<SceneTransitionType>('Fade');
  const [transitionColor, setTransitionColor] = useState('#000000');
  const [transitionMs, setTransitionMs] = useState(350);

  const finishTransition = () => {
    setTransition(null);
    params.finishProgramTransition?.();
  };

  const canTransitionTo = (sceneId: string) => {
    if (!project || !project.scenes.some((scene) => scene.id === sceneId)) return false;
    return params.canTransition?.(sceneId) ?? sceneId !== (params.programSceneId ?? project.liveSceneId);
  };

  const commitProgram = (sceneId: string) => params.commitProgram?.(sceneId) ?? true;

  const beginProgramTransition = (sceneId: string) => {
    if (!project || !canTransitionTo(sceneId) || !commitProgram(sceneId)) return false;
    const nextTransition = createSceneTransition(
      transitionType,
      params.programSceneId ?? project.liveSceneId,
      performance.now(),
      transitionMs,
      transitionColor,
    );
    setTransition(nextTransition);
    if (!nextTransition) params.finishProgramTransition?.();
    return true;
  };

  const addScene = () => {
    if (!project) return;
    const scene: StreamScene = { id: crypto.randomUUID(), name: `Scene ${project.scenes.length + 1}`, sources: [] };
    setProjectValue((current) => ({
      ...current,
      activeSceneId: scene.id,
      liveSceneId: current.studioMode ? current.liveSceneId : scene.id,
      scenes: [...current.scenes, scene],
    }));
    selectSource(null);
  };

  const renameActiveScene = () => {
    if (!project) return;
    const name = sceneNameDraft.trim().slice(0, 120);
    if (!name) return;
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === current.activeSceneId ? { ...scene, name } : scene),
    }));
    setSceneDialog(null);
  };

  /** Inline (F2/double-click) rename from the Scenes dock's own row, independent of the rename dialog above. */
  const renameScene = (sceneId: string, name: string) => {
    if (!project) return;
    const trimmed = name.trim().slice(0, 120);
    if (!trimmed) return;
    setProjectValue((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.id === sceneId ? { ...scene, name: trimmed } : scene),
    }));
  };

  /** Persists a new scene order (drag, Order submenu, or Ctrl/Cmd+Arrow), preserving every other project field. */
  const reorderScenes = (sceneIds: string[]) => {
    setProjectValue((current) => {
      const byId = new Map(current.scenes.map((scene) => [scene.id, scene]));
      const reordered = sceneIds.map((id) => byId.get(id)).filter((scene): scene is StreamScene => scene !== undefined);
      const missing = current.scenes.filter((scene) => !sceneIds.includes(scene.id));
      return { ...current, scenes: [...reordered, ...missing] };
    });
  };

  const duplicateActiveScene = async (sceneId?: string) => {
    if (!project || working) return;
    const original = project.scenes.find((scene) => scene.id === (sceneId ?? project.activeSceneId));
    if (!original) return;
    setWorking(true);
    setActionError('');
    const clone = {
      ...original,
      id: crypto.randomUUID(),
      name: (original.name + ' Copy').slice(0, 120),
      sources: original.sources.map(cloneSceneSource),
    } satisfies StreamScene;
    let runtimeLease: SceneRuntimeLease | null = null;
    try {
      const originalLeaves = flattenSourceLeaves(original.sources);
      const duplicateLeaves = flattenSourceLeaves(clone.sources);
      runtimeLease = await sceneRuntimePort.duplicateSceneRuntimes(originalLeaves.map((source, index) => ({
        source,
        duplicate: duplicateLeaves[index]!,
      })));
      selectSource(null);
      setProjectValue((current) => ({
        ...current,
        activeSceneId: clone.id,
        liveSceneId: current.studioMode ? current.liveSceneId : clone.id,
        scenes: [...current.scenes, clone],
      }));
      runtimeLease.commit();
    } catch (error) {
      runtimeLease?.rollback();
      setActionError(`Could not duplicate scene: ${friendlyError(error)}`);
    } finally { setWorking(false); }
  };

  const deleteScenes = (sceneIds: string[]) => {
    if (!project || project.scenes.length <= 1) return;
    const requestedIds = new Set(sceneIds);
    const existingIds = new Set(project.scenes.map((scene) => scene.id));
    const removedIds = new Set(Array.from(requestedIds).filter((sceneId) => existingIds.has(sceneId)));
    if (removedIds.size === 0) return;

    // A scene collection must always retain one scene. When every scene is
    // selected, keep the active scene so the preview remains valid.
    if (removedIds.size >= project.scenes.length) removedIds.delete(project.activeSceneId);
    if (removedIds.size === 0) return;

    const removesActiveScene = removedIds.has(project.activeSceneId);
    const removesLiveScene = removedIds.has(project.liveSceneId);
    setProjectValue((current) => {
      // Reconcile against the latest persisted project in case another edit
      // changed the scene list while the action was being dispatched.
      const currentRemovedIds = new Set(Array.from(removedIds).filter((sceneId) => current.scenes.some((scene) => scene.id === sceneId)));
      if (currentRemovedIds.size >= current.scenes.length) currentRemovedIds.delete(current.activeSceneId);
      const remaining = current.scenes.filter((scene) => !currentRemovedIds.has(scene.id));
      const replacement = remaining[0]!;
      const removedNodeIds = current.scenes
        .filter((scene) => currentRemovedIds.has(scene.id))
        .flatMap((scene) => flattenSourceNodes(scene.sources));
      const removedReferenceNodeIds = remaining
        .flatMap((scene) => flattenSourceNodes(scene.sources))
        .filter((source) => source.kind === 'scene' && source.referencedSceneId && currentRemovedIds.has(source.referencedSceneId));
      const removeReferences = (sources: StreamScene['sources']) => Array.from(currentRemovedIds)
        .reduce((next, sceneId) => removeSceneReferenceSources(next, sceneId), sources);
      const scenes = remaining.map((scene) => ({ ...scene, sources: removeReferences(scene.sources) }));
      const removedActive = currentRemovedIds.has(current.activeSceneId);
      const removedLive = currentRemovedIds.has(current.liveSceneId);
      return {
        ...current,
        scenes,
        activeSceneId: removedActive ? replacement.id : current.activeSceneId,
        liveSceneId: removedLive ? replacement.id : current.liveSceneId,
        sceneSwitchHotkeys: Object.fromEntries(Object.entries(current.sceneSwitchHotkeys).filter(([sceneId]) => !currentRemovedIds.has(sceneId))),
        sourceVisibilityHotkeys: removeSourceVisibilityHotkeys(
          current.sourceVisibilityHotkeys,
          [...removedNodeIds, ...removedReferenceNodeIds].map((source) => source.id),
        ),
      };
    });
    // In Studio Mode, deleting editable scene data must not change the
    // immutable Program graph or interrupt its outgoing fade.
    if ((removesActiveScene || removesLiveScene) && (!project.studioMode || !params.commitProgram)) finishTransition();
    if (removesActiveScene) selectSource(null);
    setSceneDialog(null);
  };

  const deleteActiveScene = () => {
    if (!project) return;
    deleteScenes([project.activeSceneId]);
  };

  const chooseScene = (sceneId: string) => {
    if (!project) return;
    if (project.studioMode) {
      setProjectValue((current) => ({ ...current, activeSceneId: sceneId }));
      selectSource(null);
      return;
    }
    if (sceneId === project.liveSceneId) return;
    if (!beginProgramTransition(sceneId)) return;
    setProjectValue((current) => ({ ...current, activeSceneId: sceneId, liveSceneId: sceneId }));
    selectSource(null);
  };

  const transitionScene = (sceneId?: string) => {
    if (!project) return;
    const targetSceneId = sceneId ?? project.activeSceneId;
    if (!beginProgramTransition(targetSceneId)) return;
    setProjectValue((current) => ({ ...current, activeSceneId: targetSceneId, liveSceneId: targetSceneId }));
    if (targetSceneId !== project.activeSceneId) selectSource(null);
  };

  const toggleStudioMode = () => {
    if (!project || transition) return;
    setProjectValue((current) => ({ ...current, studioMode: !current.studioMode, activeSceneId: current.studioMode ? current.liveSceneId : current.activeSceneId }));
  };

  // Sets preview to `sceneId` and immediately transitions it to program, atomically so it works
  // the same whether or not Studio Mode is on.
  const transitionToScene = (sceneId: string) => {
    if (!project || !beginProgramTransition(sceneId)) return;
    setProjectValue((current) => ({ ...current, activeSceneId: sceneId, liveSceneId: sceneId }));
    selectSource(null);
  };

  const resetForWorkspaceChange = () => {
    setTransition(null);
    params.finishProgramTransition?.();
  };

  return {
    sceneDialog, setSceneDialog, sceneNameDraft, setSceneNameDraft,
    transition, transitionType, setTransitionType, transitionColor, setTransitionColor, transitionMs, setTransitionMs,
    finishTransition,
    addScene, renameActiveScene, renameScene, reorderScenes, duplicateActiveScene, deleteActiveScene, deleteScenes,
    chooseScene, transitionScene, toggleStudioMode, transitionToScene,
    resetForWorkspaceChange,
  };
}
