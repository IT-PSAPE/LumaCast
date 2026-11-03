import type { StreamProject, StreamSource } from '../shared/desktop-api';
import { getVisibleSourceIdsForScenes } from '../shared/scene-reference-graph';
import { flattenSourceNodes } from '../shared/source-tree';
import { isSlideSource } from './slideshow';
import { getSourceRuntimeId } from './source-runtime';

function visibleSlides(project: StreamProject | null, sceneIds: string[]): StreamSource[] {
  if (!project) return [];
  const visibleIds = getVisibleSourceIdsForScenes(project.scenes, sceneIds);
  return project.scenes.flatMap((scene) => flattenSourceNodes(scene.sources))
    .filter((source) => visibleIds.has(source.id) && isSlideSource(source));
}

/** Prefer on-air decks while keeping visible decks selectable as Preview changes. */
export function slideControlSources(
  draft: StreamProject | null,
  program: StreamProject | null,
  programSceneId: string | null,
): StreamSource[] {
  const candidates = [
    ...visibleSlides(program, programSceneId ? [programSceneId] : []),
    ...visibleSlides(draft, draft ? [draft.activeSceneId] : []),
    ...visibleSlides(draft, draft?.scenes.map((scene) => scene.id) ?? []),
  ];
  const unique = new Map<string, StreamSource>();
  for (const source of candidates) {
    const id = getSourceRuntimeId(source);
    if (!unique.has(id)) unique.set(id, source);
  }
  return [...unique.values()];
}

export function resolveSlideControlSource(sources: readonly StreamSource[], sessionId: string | null): StreamSource | null {
  return sources.find((source) => getSourceRuntimeId(source) === sessionId) ?? sources[0] ?? null;
}
