import type { RenderNode } from './scene-types';

// Shared scene traversal and layer-order contract. Every rendering surface
// (editor preview and NDI capture) walks the scene through this module so the
// visibility filter, back→front ordering, and node frame transform (position,
// size, rotation, opacity, flip) live in exactly one place. The module is
// renderer-agnostic: it carries no Konva, DOM, capture, selection, or editor
// state, so output-only and editor-only behavior stays in the adapters.

export interface SceneNodeFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface SceneTraversalEntry {
  node: RenderNode;
  frame: SceneNodeFrame;
  /** Original index in the scene's back→front array (hidden nodes keep their slot). */
  order: number;
}

export function isSceneNodeVisible(node: RenderNode): boolean {
  return node.visual.visible !== false;
}

export function sceneNodeFrame(node: RenderNode): SceneNodeFrame {
  const { width, height } = node.element;
  return {
    x: node.element.x,
    y: node.element.y,
    width,
    height,
    rotation: node.element.rotation,
    opacity: node.element.opacity,
    scaleX: node.visual.flipX ? -1 : 1,
    scaleY: node.visual.flipY ? -1 : 1,
    offsetX: node.visual.flipX ? width : 0,
    offsetY: node.visual.flipY ? height : 0,
  };
}

export function traverseSceneNodes(nodes: readonly RenderNode[]): SceneTraversalEntry[] {
  const entries: SceneTraversalEntry[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!isSceneNodeVisible(node)) continue;
    entries.push({ node, frame: sceneNodeFrame(node), order: i });
  }
  return entries;
}