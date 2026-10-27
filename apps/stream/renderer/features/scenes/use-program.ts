import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StreamProject, StreamScene } from '../../../shared/desktop-api';
import {
  createProgramSnapshot, programConfigurationMatches, programSnapshotToProject, type ProgramSnapshot,
} from '../../program-state';

interface ProgramState {
  workspaceKey: string | null;
  snapshot: ProgramSnapshot | null;
  outgoingSnapshot: ProgramSnapshot | null;
}

export interface UseProgramParams {
  project: StreamProject | null;
  /** Changes whenever the loaded collection/profile document changes. */
  workspaceKey: string | null;
}

export interface UseProgramResult {
  programSnapshot: ProgramSnapshot | null;
  programProject: StreamProject | null;
  programScene: StreamScene | null;
  programSceneId: string | null;
  outgoingSnapshot: ProgramSnapshot | null;
  outgoingProject: StreamProject | null;
  outgoingScene: StreamScene | null;
  canTransition: (sceneId: string) => boolean;
  commitProgram: (sceneId: string) => boolean;
  finishOutgoingProgram: () => void;
  resetForWorkspaceChange: () => void;
}

/**
 * Keeps the on-air scene graph separate from editable project state. Studio
 * Mode commits only through Transition; single-view mode follows draft edits
 * directly. Program state is session-only and is rebuilt on workspace loads.
 */
export function useProgram({ project, workspaceKey }: UseProgramParams): UseProgramResult {
  const [state, setState] = useState<ProgramState>({ workspaceKey: null, snapshot: null, outgoingSnapshot: null });

  const stateMatchesWorkspace = state.workspaceKey === workspaceKey;
  const programSnapshot = useMemo(() => {
    if (!project) return null;
    if (!project.studioMode) return createProgramSnapshot(project, project.liveSceneId);
    if (stateMatchesWorkspace && state.snapshot) return state.snapshot;
    return createProgramSnapshot(project, project.liveSceneId);
  }, [project, stateMatchesWorkspace, state.snapshot]);
  const outgoingSnapshot = stateMatchesWorkspace ? state.outgoingSnapshot : null;

  useEffect(() => {
    if (!project) {
      setState((current) => current.workspaceKey === workspaceKey && !current.snapshot && !current.outgoingSnapshot
        ? current
        : { workspaceKey, snapshot: null, outgoingSnapshot: null });
      return;
    }
    setState((current) => {
      const sameWorkspace = current.workspaceKey === workspaceKey;
      const snapshot = !project.studioMode
        ? createProgramSnapshot(project, project.liveSceneId)
        : sameWorkspace && current.snapshot
          ? current.snapshot
          : createProgramSnapshot(project, project.liveSceneId);
      const next = {
        workspaceKey,
        snapshot,
        outgoingSnapshot: sameWorkspace ? current.outgoingSnapshot : null,
      };
      return sameWorkspace && next.snapshot === current.snapshot && next.outgoingSnapshot === current.outgoingSnapshot
        ? current
        : next;
    });
  }, [project, workspaceKey]);

  const canTransition = useCallback((sceneId: string): boolean => {
    if (!project || !programSnapshot || !project.scenes.some((scene) => scene.id === sceneId)) return false;
    if (outgoingSnapshot) return false;
    return sceneId !== programSnapshot.sceneId || !programConfigurationMatches(project, programSnapshot, sceneId);
  }, [outgoingSnapshot, programSnapshot, project]);

  const commitProgram = useCallback((sceneId: string): boolean => {
    if (!canTransition(sceneId) || !project || !programSnapshot) return false;
    const nextSnapshot = createProgramSnapshot(project, sceneId);
    if (!nextSnapshot) return false;
    setState((current) => ({
      workspaceKey,
      snapshot: nextSnapshot,
      outgoingSnapshot: current.workspaceKey === workspaceKey ? programSnapshot : null,
    }));
    return true;
  }, [canTransition, programSnapshot, project, workspaceKey]);

  const finishOutgoingProgram = useCallback(() => {
    setState((current) => current.workspaceKey === workspaceKey && current.outgoingSnapshot
      ? { ...current, outgoingSnapshot: null }
      : current);
  }, [workspaceKey]);

  const resetForWorkspaceChange = useCallback(() => {
    setState({ workspaceKey: null, snapshot: null, outgoingSnapshot: null });
  }, []);

  // Only committed snapshots drive these views. Depending on the editable
  // project would rebuild the on-air graph and restart its compositor on every
  // Preview edit; workspace and mode changes still refresh the inherited metadata.
  const programProject = useMemo(() => project && programSnapshot
    ? programSnapshotToProject(project, programSnapshot)
    : null, [workspaceKey, project?.studioMode, programSnapshot]);
  const outgoingProject = useMemo(() => project && outgoingSnapshot
    ? programSnapshotToProject(project, outgoingSnapshot)
    : null, [workspaceKey, project?.studioMode, outgoingSnapshot]);

  return {
    programSnapshot,
    programProject,
    programScene: programSnapshot?.scenes.find((scene) => scene.id === programSnapshot.sceneId) ?? null,
    programSceneId: programSnapshot?.sceneId ?? null,
    outgoingSnapshot,
    outgoingProject,
    outgoingScene: outgoingSnapshot?.scenes.find((scene) => scene.id === outgoingSnapshot.sceneId) ?? null,
    canTransition,
    commitProgram,
    finishOutgoingProgram,
    resetForWorkspaceChange,
  };
}
