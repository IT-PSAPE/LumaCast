import { flattenSourceNodes } from '../shared/source-tree';
import type { StreamOutputConfiguration, StreamProject, StreamScene } from '../shared/desktop-api';

/** Volatile on-air configuration, intentionally separate from persisted draft state. */
export interface ProgramSnapshot {
  sceneId: string;
  /** Root scene and every scene reachable through a scene-source reference. */
  scenes: StreamScene[];
  output: StreamOutputConfiguration;
}

function reachableScenes(scenes: readonly StreamScene[], rootSceneId: string): StreamScene[] {
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const result: StreamScene[] = [];
  const visited = new Set<string>();
  const visit = (sceneId: string) => {
    if (visited.has(sceneId)) return;
    visited.add(sceneId);
    const scene = byId.get(sceneId);
    if (!scene) return;
    result.push(scene);
    for (const source of flattenSourceNodes(scene.sources)) {
      if (source.kind === 'scene' && source.referencedSceneId) visit(source.referencedSceneId);
    }
  };
  visit(rootSceneId);
  return result;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createProgramSnapshot(project: StreamProject, sceneId = project.liveSceneId): ProgramSnapshot | null {
  if (!project.scenes.some((scene) => scene.id === sceneId)) return null;
  return {
    sceneId,
    scenes: clone(reachableScenes(project.scenes, sceneId)),
    output: clone(project.output),
  };
}

/** Builds a renderable project view without writing Program state into the draft. */
export function programSnapshotToProject(project: StreamProject, snapshot: ProgramSnapshot): StreamProject {
  return {
    ...project,
    output: snapshot.output,
    scenes: snapshot.scenes,
    activeSceneId: snapshot.sceneId,
    liveSceneId: snapshot.sceneId,
  };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * Compares only the target scene's referenced graph and output settings. A
 * changed reachable config enables a same-scene Transition; unrelated scenes
 * in the collection do not.
 */
export function programConfigurationMatches(
  project: StreamProject,
  snapshot: ProgramSnapshot,
  sceneId = snapshot.sceneId,
): boolean {
  const draftGraph = reachableScenes(project.scenes, sceneId);
  return stableSerialize(project.output) === stableSerialize(snapshot.output)
    && stableSerialize(draftGraph) === stableSerialize(snapshot.scenes);
}
