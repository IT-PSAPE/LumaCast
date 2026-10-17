import type { StreamScene } from '../shared/desktop-api';

export function getRenderedSourceIds(
  scenes: StreamScene[],
  activeSceneId: string | null,
  liveSceneId: string | null,
  multiview: boolean,
): Set<string> {
  const renderedScenes = multiview
    ? scenes
    : scenes.filter((scene) => scene.id === activeSceneId || scene.id === liveSceneId);
  return new Set(renderedScenes.flatMap((scene) => scene.sources.filter((source) => source.visible).map((source) => source.id)));
}
