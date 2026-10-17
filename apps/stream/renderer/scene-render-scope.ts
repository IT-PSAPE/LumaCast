import type { StreamScene } from '../shared/desktop-api';

export function getVisibleSourceIds(sources: StreamScene['sources']): Set<string> {
  const rendered = new Set<string>();
  const addVisible = (items: StreamScene['sources']) => {
    for (const source of items) {
      if (!source.visible) continue;
      rendered.add(source.id);
      if (source.kind === 'group') addVisible(source.children ?? []);
    }
  };
  addVisible(sources);
  return rendered;
}

export function getRenderedSourceIds(
  scenes: StreamScene[],
  activeSceneId: string | null,
  liveSceneId: string | null,
  multiview: boolean,
): Set<string> {
  const renderedScenes = multiview
    ? scenes
    : scenes.filter((scene) => scene.id === activeSceneId || scene.id === liveSceneId);
  const rendered = new Set<string>();
  for (const scene of renderedScenes) for (const sourceId of getVisibleSourceIds(scene.sources)) rendered.add(sourceId);
  return rendered;
}
