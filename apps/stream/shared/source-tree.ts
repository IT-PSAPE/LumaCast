import type { SourceTransform, StreamSource } from './desktop-api';

export const MAX_SOURCE_GROUP_DEPTH = 32;

/** Returns the leaf sources in back-to-front tree order. */
export function flattenSourceLeaves(sources: readonly StreamSource[]): StreamSource[] {
  const leaves: StreamSource[] = [];
  for (const source of sources) {
    if (source.kind === 'group') leaves.push(...flattenSourceLeaves(source.children ?? []));
    else leaves.push(source);
  }
  return leaves;
}

/** Returns groups and leaves in preorder, preserving sibling stacking order. */
export function flattenSourceNodes(sources: readonly StreamSource[]): StreamSource[] {
  const nodes: StreamSource[] = [];
  for (const source of sources) {
    nodes.push(source);
    if (source.kind === 'group') nodes.push(...flattenSourceNodes(source.children ?? []));
  }
  return nodes;
}

/** Updates the source with the matching id, recursively preserving the tree shape and order. */
export function mapSourceTreeById(
  sources: readonly StreamSource[],
  sourceId: string,
  update: (source: StreamSource) => StreamSource,
): StreamSource[] {
  return sources.map((original) => {
    if (original.id === sourceId) {
      const updated = update(original);
      if (original.kind !== 'group' || updated.kind !== 'group' || sameTransform(original.transform, updated.transform)) return updated;
      return { ...updated, children: transformGroupChildren(original.children ?? [], original.transform, updated.transform) };
    }
    if (original.kind !== 'group') return original;
    const children = mapSourceTreeById(original.children ?? [], sourceId, update);
    if (children.every((child, index) => child === original.children?.[index])) return original;
    return { ...original, children, transform: computeGroupBoundingTransform(children) ?? original.transform };
  });
}

/** Removes one source and its entire subtree, recalculating enclosing group bounds. */
export function removeSourceTreeById(sources: readonly StreamSource[], sourceId: string): StreamSource[] {
  const next = sources.filter((source) => source.id !== sourceId).map((source) => {
    if (source.kind !== 'group') return source;
    const children = removeSourceTreeById(source.children ?? [], sourceId);
    if (children.length === (source.children ?? []).length) return source;
    return { ...source, children, transform: computeGroupBoundingTransform(children) ?? source.transform };
  });
  return next;
}

/** Removes scene-source nodes targeting a deleted scene, including nodes inside groups. */
export function removeSceneReferenceSources(sources: readonly StreamSource[], referencedSceneId: string): StreamSource[] {
  const referenceIds = flattenSourceNodes(sources)
    .filter((source) => source.kind === 'scene' && source.referencedSceneId === referencedSceneId)
    .map((source) => source.id);
  return referenceIds.reduce((current, sourceId) => removeSourceTreeById(current, sourceId), [...sources]);
}

/** Reorders a source among siblings, including within a group. */
export function moveSourceTreeNode(sources: readonly StreamSource[], sourceId: string, direction: -1 | 1): StreamSource[] {
  const index = sources.findIndex((source) => source.id === sourceId);
  if (index >= 0) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sources.length) return [...sources];
    const reordered = [...sources];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex]!, reordered[index]!];
    return reordered;
  }
  return sources.map((source) => source.kind === 'group'
    ? { ...source, children: moveSourceTreeNode(source.children ?? [], sourceId, direction) }
    : source);
}

export interface SourceSiblingSelection {
  sources: StreamSource[];
  parentDepth: number;
}

/** Finds a contiguous selection at any group depth, preserving sibling stacking order. */
export function findSourceSiblingSelection(sources: readonly StreamSource[], sourceIds: readonly string[]): SourceSiblingSelection | null {
  if (sourceIds.length < 2 || new Set(sourceIds).size !== sourceIds.length) return null;
  const selected = new Set(sourceIds);
  const findAtLevel = (siblings: readonly StreamSource[], parentDepth: number): SourceSiblingSelection | null => {
    const indices = siblings.map((source, index) => selected.has(source.id) ? index : -1).filter((index) => index >= 0);
    if (indices.length === selected.size && indices.every((index, position) => position === 0 || index === indices[position - 1]! + 1)) {
      return { sources: siblings.slice(indices[0], indices[indices.length - 1]! + 1), parentDepth };
    }
    for (const source of siblings) {
      if (source.kind !== 'group') continue;
      const nested = findAtLevel(source.children ?? [], parentDepth + 1);
      if (nested) return nested;
    }
    return null;
  };
  return findAtLevel(sources, 0);
}

function groupTreeDepth(source: StreamSource): number {
  if (source.kind !== 'group') return 0;
  return 1 + Math.max(0, ...(source.children ?? []).map(groupTreeDepth));
}

export function canGroupSourceSiblings(sources: readonly StreamSource[], sourceIds: readonly string[]): boolean {
  const selection = findSourceSiblingSelection(sources, sourceIds);
  return Boolean(selection && selection.parentDepth + 1 + Math.max(0, ...selection.sources.map(groupTreeDepth)) <= MAX_SOURCE_GROUP_DEPTH);
}

/** Wraps a contiguous sibling selection at any group depth without changing layer order. */
export function groupSourceSiblings(sources: readonly StreamSource[], sourceIds: readonly string[], group: StreamSource): StreamSource[] | null {
  if (sourceIds.length < 2 || group.kind !== 'group') return null;
  const selection = findSourceSiblingSelection(sources, sourceIds);
  if (!selection || selection.parentDepth + 1 + Math.max(0, ...selection.sources.map(groupTreeDepth)) > MAX_SOURCE_GROUP_DEPTH
    || (group.children?.length ?? 0) !== selection.sources.length
    || selection.sources.some((source, index) => group.children?.[index]?.id !== source.id)) return null;

  const replaceAtLevel = (siblings: readonly StreamSource[]): StreamSource[] | null => {
    const selected = new Set(sourceIds);
    const indices = siblings.map((source, index) => selected.has(source.id) ? index : -1).filter((index) => index >= 0);
    if (indices.length === sourceIds.length && indices.every((index, position) => position === 0 || index === indices[position - 1]! + 1)) {
      const insertAt = indices[0]!;
      return [...siblings.slice(0, insertAt), group, ...siblings.slice(indices[indices.length - 1]! + 1)];
    }
    for (let index = 0; index < siblings.length; index += 1) {
      const source = siblings[index]!;
      if (source.kind !== 'group') continue;
      const children = replaceAtLevel(source.children ?? []);
      if (!children) continue;
      const next = [...siblings];
      next[index] = { ...source, children, transform: computeGroupBoundingTransform(children) ?? source.transform };
      return next;
    }
    return null;
  };
  return replaceAtLevel(sources);
}

/** Replaces a group at any tree depth with its children in the same stacking position. */
export function ungroupSourceNode(sources: readonly StreamSource[], sourceId: string): StreamSource[] | null {
  const replaceAtLevel = (siblings: readonly StreamSource[]): StreamSource[] | null => {
    const index = siblings.findIndex((source) => source.id === sourceId && source.kind === 'group');
    if (index >= 0) {
      const group = siblings[index]!;
      return [...siblings.slice(0, index), ...(group.children ?? []), ...siblings.slice(index + 1)];
    }
    for (let siblingIndex = 0; siblingIndex < siblings.length; siblingIndex += 1) {
      const source = siblings[siblingIndex]!;
      if (source.kind !== 'group') continue;
      const children = replaceAtLevel(source.children ?? []);
      if (!children) continue;
      const next = [...siblings];
      next[siblingIndex] = { ...source, children, transform: computeGroupBoundingTransform(children) ?? source.transform };
      return next;
    }
    return null;
  };
  return replaceAtLevel(sources);
}

function sameTransform(left: SourceTransform, right: SourceTransform): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}

/** Scales and moves a group's leaf sources from one scene-space bound to another. */
export function transformGroupChildren(
  children: readonly StreamSource[],
  from: SourceTransform,
  to: SourceTransform,
): StreamSource[] {
  const scaleX = to.width / Math.max(1, from.width);
  const scaleY = to.height / Math.max(1, from.height);
  const transformChild = (transform: SourceTransform): SourceTransform => ({
    x: Math.max(-32768, Math.min(32768, Math.round(to.x + (transform.x - from.x) * scaleX))),
    y: Math.max(-32768, Math.min(32768, Math.round(to.y + (transform.y - from.y) * scaleY))),
    width: Math.max(1, Math.min(32768, Math.round(transform.width * scaleX))),
    height: Math.max(1, Math.min(32768, Math.round(transform.height * scaleY))),
  });
  return children.map((child) => {
    if (child.kind === 'group') {
      if (!computeGroupBoundingTransform(child.children ?? [])) return child;
      const transform = transformChild(child.transform);
      return { ...child, transform, children: transformGroupChildren(child.children ?? [], child.transform, transform) };
    }
    const audioOnly = child.kind === 'microphone' || child.kind === 'desktop-audio' || child.kind === 'application-audio'
      || (child.kind === 'media' && child.mediaKind === 'audio');
    if (audioOnly) return child;
    return {
      ...child,
      transform: transformChild(child.transform),
    };
  });
}

/** Bounds non-group children in their shared scene coordinate space; empty groups have no bounds. */
export function computeGroupBoundingTransform(children: readonly StreamSource[]): SourceTransform | null {
  const bounds = children.flatMap((source) => {
    if (source.kind === 'group') {
      const nested = computeGroupBoundingTransform(source.children ?? []);
      return nested ? [nested] : [];
    }
    const audioOnly = source.kind === 'microphone' || source.kind === 'desktop-audio' || source.kind === 'application-audio'
      || (source.kind === 'media' && source.mediaKind === 'audio');
    return audioOnly ? [] : [source.transform];
  });
  if (bounds.length === 0) return null;

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const transform of bounds) {
    const x1 = Math.min(transform.x, transform.x + transform.width);
    const y1 = Math.min(transform.y, transform.y + transform.height);
    const x2 = Math.max(transform.x, transform.x + transform.width);
    const y2 = Math.max(transform.y, transform.y + transform.height);
    left = Math.min(left, x1);
    top = Math.min(top, y1);
    right = Math.max(right, x2);
    bottom = Math.max(bottom, y2);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}
