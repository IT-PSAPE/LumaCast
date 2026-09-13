import type { ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import { SceneNodeGroup } from './scene-node-group';
import { SceneNodeMedia } from './scene-node-media';
import { SceneNodeShape } from './scene-node-shape';
import { SceneNodeText } from './scene-node-text';
import type { RenderNode, SceneSurface } from '@lumacast/composition';

export interface SceneNodeContentOptions {
  /**
   * Output-only hook: called with a media node's own id when its content
   * first resolves. The same options flow unchanged into a group's children
   * (see scene-node-group.tsx), so this reports whichever node — top-level
   * or nested at any depth — actually loaded, not the group's id; a caller
   * that only ever renders leaf nodes (never a group) can ignore the
   * argument exactly as it did before this parameter existed.
   */
  onMediaLoad?: (nodeId: Id) => void;
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
  if (node.element.type === 'group') return <SceneNodeGroup node={node} surface={surface} options={options} />;
  return null;
}
