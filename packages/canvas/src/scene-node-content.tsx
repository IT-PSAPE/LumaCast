import type { ReactNode } from 'react';
import { SceneNodeMedia } from './scene-node-media';
import { SceneNodeShape } from './scene-node-shape';
import { SceneNodeText } from './scene-node-text';
import type { RenderNode, SceneSurface } from '@lumacast/composition';

export interface SceneNodeContentOptions {
  /** Output-only hook: called when a media node's content first resolves. */
  onMediaLoad?: () => void;
  /**
   * Editor-only: the inline text editor is rendering this element's text in
   * the DOM, so the canvas must not draw it as well. The element's own
   * background (fill/stroke/shadow) keeps rendering on the canvas.
   */
  hideText?: boolean;
}

// Shared node→content dispatch for the Konva surfaces. The editor preview and
// NDI capture adapters both call this so the mapping from element kind to its
// content renderer exists in exactly one place. Adapter-specific behavior is
// passed through options (NDI notifies media loads to trigger captures; the
// editor leaves it unset).
export function renderSceneNodeContent(
  node: RenderNode,
  surface: SceneSurface,
  options: SceneNodeContentOptions = {},
): ReactNode {
  if (node.element.type === 'shape') return <SceneNodeShape node={node} />;
  if (node.element.type === 'text') return <SceneNodeText node={node} hideText={options.hideText} />;
  if (node.element.type === 'image' || node.element.type === 'video') {
    return <SceneNodeMedia node={node} surface={surface} onLoad={options.onMediaLoad} />;
  }
  return null;
}
