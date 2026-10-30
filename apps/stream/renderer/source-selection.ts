import { computeGroupBoundingTransform, flattenSourceNodes } from '../shared/source-tree';
import type { SourceTransform, StreamSource } from '../shared/desktop-api';

/** Source ids in the same front-to-back order shown by the Sources dock. */
export function sourceRowOrder(sources: readonly StreamSource[], collapsedGroupIds: readonly string[] = []): string[] {
  const ids: string[] = [];
  for (const source of [...sources].reverse()) {
    ids.push(source.id);
    if (source.kind === 'group' && !collapsedGroupIds.includes(source.id)) {
      ids.push(...sourceRowOrder(source.children ?? [], collapsedGroupIds));
    }
  }
  return ids;
}

/** Canvas range order excludes hidden descendants and audio-only layer rows. */
export function sourceCanvasSelectionOrder(sources: readonly StreamSource[]): string[] {
  const byId = new Map(flattenSourceNodes(sources).map((source) => [source.id, source] as const));
  return sourceRowOrder(sources).filter((id) => {
    const source = byId.get(id);
    return source !== undefined && isSourceVisibleInTree(sources, id) && supportsTransform(source);
  });
}

/** Return only selected nodes whose selected ancestors do not already own the subtree. */
export function selectedSourceRoots(sources: readonly StreamSource[], selectedIds: readonly string[]): StreamSource[] {
  const selected = new Set(selectedIds);
  const roots: StreamSource[] = [];
  const visit = (nodes: readonly StreamSource[], selectedAncestor: boolean) => {
    for (const source of nodes) {
      const isSelected = selected.has(source.id);
      if (isSelected && !selectedAncestor) roots.push(source);
      if (source.kind === 'group') visit(source.children ?? [], selectedAncestor || isSelected);
    }
  };
  visit(sources, false);
  return roots;
}

/** True when the source is visible through every containing group. */
export function isSourceVisibleInTree(sources: readonly StreamSource[], sourceId: string): boolean {
  const visit = (nodes: readonly StreamSource[], ancestorsVisible: boolean): boolean => {
    for (const source of nodes) {
      const visible = ancestorsVisible && source.visible !== false;
      if (source.id === sourceId) return visible;
      if (source.kind === 'group' && visit(source.children ?? [], visible)) return true;
    }
    return false;
  };
  return visit(sources, true);
}

function supportsTransform(source: StreamSource): boolean {
  return source.kind !== 'microphone' && source.kind !== 'desktop-audio' && source.kind !== 'application-audio'
    && !(source.kind === 'media' && source.mediaKind === 'audio');
}

/** Group resize transforms every transformable descendant, so it is safe only when none are protected. */
export function canResizeSourceTree(source: StreamSource): boolean {
  if (source.visible === false || source.locked) return false;
  if (source.kind !== 'group') return supportsTransform(source);
  return (source.children ?? []).every(canResizeSourceTree);
}

/** Canvas transforms are disabled when this source or any containing group is protected. */
export function isSourceTransformableInTree(sources: readonly StreamSource[], sourceId: string): boolean {
  const visit = (nodes: readonly StreamSource[], ancestorsTransformable: boolean): boolean => {
    for (const source of nodes) {
      const transformable = ancestorsTransformable && source.visible !== false && !source.locked;
      if (source.id === sourceId) return transformable && supportsTransform(source);
      if (source.kind === 'group' && visit(source.children ?? [], transformable)) return true;
    }
    return false;
  };
  return visit(sources, true);
}

function translateTransform(transform: SourceTransform, dx: number, dy: number): SourceTransform {
  return { ...transform, x: Math.round(transform.x + dx), y: Math.round(transform.y + dy) };
}

/**
 * Translate selected source roots as one canvas gesture. A selected group moves
 * its visible, unlocked transformable descendants; protected descendants and
 * descendants beneath protected groups stay in place.
 */
export function translateSourceSelection(
  sources: readonly StreamSource[],
  selectedIds: readonly string[],
  dx: number,
  dy: number,
  movableIds?: readonly string[],
): StreamSource[] {
  if (dx === 0 && dy === 0 || selectedIds.length === 0) return [...sources];
  const selected = new Set(selectedIds);
  const movable = movableIds ? new Set(movableIds) : null;
  const translateNodes = (
    nodes: readonly StreamSource[],
    ancestorsMovable: boolean,
    selectedAncestor: boolean,
  ): StreamSource[] => nodes.map((source) => {
    if (!ancestorsMovable || source.visible === false || source.locked) return source;
    const ownsSubtree = selectedAncestor || selected.has(source.id);
    if (source.kind === 'group') {
      const children = translateNodes(source.children ?? [], true, ownsSubtree);
      if (children.every((child, index) => child === source.children?.[index])) return source;
      const bounds = computeGroupBoundingTransform(children);
      const transform = bounds
        ? { ...bounds, ...(source.transform.rotation === undefined ? {} : { rotation: source.transform.rotation }) }
        : source.transform;
      return { ...source, children, transform };
    }
    if (!ownsSubtree || (movable !== null && !movable.has(source.id)) || !supportsTransform(source)) return source;
    return { ...source, transform: translateTransform(source.transform, dx, dy) };
  });

  return translateNodes(sources, true, false);
}

/** Selected node outlines that are visible in the canvas, without duplicate child frames. */
export function visibleSelectedSourceRoots(sources: readonly StreamSource[], selectedIds: readonly string[]): StreamSource[] {
  const selected = new Set(selectedIds);
  const roots: StreamSource[] = [];
  const visit = (nodes: readonly StreamSource[], ancestorsVisible: boolean, selectedAncestor: boolean) => {
    if (!ancestorsVisible) return;
    for (const source of nodes) {
      if (source.visible === false) continue;
      const isSelected = selected.has(source.id);
      if (isSelected && !selectedAncestor) roots.push(source);
      if (source.kind === 'group') visit(source.children ?? [], true, selectedAncestor || isSelected);
    }
  };
  visit(sources, true, false);
  return roots;
}
