import type { StreamScene, StreamSource } from './desktop-api';

export const MAX_SCENE_REFERENCE_DEPTH = 32;

type ReferenceSource = Pick<StreamSource, 'id' | 'kind' | 'visible' | 'children'> & {
  referencedSceneId?: unknown;
};

type ReferenceScene = Pick<StreamScene, 'id'> & {
  sources: readonly ReferenceSource[];
};

type SceneGraph = Map<string, string[]>;

function visitSourceTree(sources: readonly ReferenceSource[], visit: (source: ReferenceSource) => void): void {
  const visited = new WeakSet<object>();
  const visitItems = (items: readonly ReferenceSource[]) => {
    for (const source of items) {
      if (visited.has(source)) continue;
      visited.add(source);
      visit(source);
      if (source.kind === 'group' && Array.isArray(source.children)) visitItems(source.children);
    }
  };
  visitItems(sources);
}

function createSceneGraph(scenes: readonly ReferenceScene[]): { graph: SceneGraph; error: string | null } {
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const graph: SceneGraph = new Map(scenes.map((scene) => [scene.id, []]));

  for (const scene of scenes) {
    let error: string | null = null;
    visitSourceTree(scene.sources, (source) => {
      if (error || (source.kind as string) !== 'scene') return;
      if (typeof source.referencedSceneId !== 'string' || source.referencedSceneId.trim().length === 0) {
        error = 'A scene source must reference a scene.';
      } else if (!sceneIds.has(source.referencedSceneId)) {
        error = 'A scene source references a scene that does not exist.';
      } else {
        graph.get(scene.id)?.push(source.referencedSceneId);
      }
    });
    if (error) return { graph, error };
  }

  return { graph, error: null };
}

function validateGraph(graph: SceneGraph): string | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const depths = new Map<string, number>();
  const visit = (sceneId: string): { depth: number; error: string | null } => {
    if (state.get(sceneId) === 'visiting') return { depth: 0, error: 'Scene references cannot contain a cycle.' };
    if (state.get(sceneId) === 'done') return { depth: depths.get(sceneId) ?? 0, error: null };
    state.set(sceneId, 'visiting');
    let depth = 0;
    for (const targetId of graph.get(sceneId) ?? []) {
      const target = visit(targetId);
      if (target.error) return target;
      depth = Math.max(depth, target.depth + 1);
      if (depth > MAX_SCENE_REFERENCE_DEPTH) {
        return { depth, error: 'Scene references exceed the maximum nesting depth.' };
      }
    }
    state.set(sceneId, 'done');
    depths.set(sceneId, depth);
    return { depth, error: null };
  };

  for (const rootId of graph.keys()) {
    const result = visit(rootId);
    if (result.error) return result.error;
  }
  return null;
}

/** Validates scene-source targets and rejects cyclic or excessively deep reference chains. */
export function getSceneReferenceValidationError(scenes: readonly StreamScene[]): string | null {
  const { graph, error } = createSceneGraph(scenes);
  return error ?? validateGraph(graph);
}

/** Returns whether adding owner -> target keeps the scene-reference graph valid. */
export function canReferenceScene(
  scenes: readonly StreamScene[],
  ownerSceneId: string,
  targetSceneId: string,
): boolean {
  if (!ownerSceneId || !targetSceneId || ownerSceneId === targetSceneId) return false;
  const { graph, error } = createSceneGraph(scenes);
  if (error || !graph.has(ownerSceneId) || !graph.has(targetSceneId) || validateGraph(graph)) return false;
  graph.get(ownerSceneId)!.push(targetSceneId);
  return validateGraph(graph) === null;
}

/** Collects visible source IDs from roots and their visible groups and scene references. */
export function getVisibleSourceIdsForScenes(
  scenes: readonly StreamScene[],
  rootSceneIds: readonly string[],
): Set<string> {
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const visibleSourceIds = new Set<string>();
  const shallowestSceneDepth = new Map<string, number>();
  const activeScenes = new Set<string>();

  const visitScene = (sceneId: string, referenceDepth: number) => {
    if (referenceDepth > MAX_SCENE_REFERENCE_DEPTH || activeScenes.has(sceneId)) return;
    const previousDepth = shallowestSceneDepth.get(sceneId);
    if (previousDepth !== undefined && previousDepth <= referenceDepth) return;
    const scene = sceneById.get(sceneId);
    if (!scene) return;
    shallowestSceneDepth.set(sceneId, referenceDepth);
    activeScenes.add(sceneId);
    const visitedSources = new WeakSet<object>();
    const visitSources = (sources: readonly StreamSource[]) => {
      for (const source of sources) {
        if (!source || typeof source !== 'object' || visitedSources.has(source) || !source.visible) continue;
        visitedSources.add(source);
        visibleSourceIds.add(source.id);
        if (source.kind === 'group') {
          visitSources(source.children ?? []);
        } else if ((source.kind as string) === 'scene' && referenceDepth < MAX_SCENE_REFERENCE_DEPTH) {
          const referencedSceneId = (source as StreamSource & { referencedSceneId?: string }).referencedSceneId;
          if (typeof referencedSceneId === 'string') visitScene(referencedSceneId, referenceDepth + 1);
        }
      }
    };
    visitSources(scene.sources);
    activeScenes.delete(sceneId);
  };

  for (const rootSceneId of rootSceneIds) visitScene(rootSceneId, 0);
  return visibleSourceIds;
}
