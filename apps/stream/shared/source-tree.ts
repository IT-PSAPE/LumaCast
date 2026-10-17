import type { SourceTransform, StreamSource } from './desktop-api';

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

/** Wraps a contiguous selection of sibling leaves in a new group without changing layer order. */
export function groupSourceSiblings(sources: readonly StreamSource[], sourceIds: readonly string[], group: StreamSource): StreamSource[] | null {
  if (sourceIds.length < 2 || group.kind !== 'group' || (group.children?.length ?? 0) !== sourceIds.length) return null;
  const selected = new Set(sourceIds);
  if (selected.size !== sourceIds.length) return null;
  const indices = sources.map((source, index) => selected.has(source.id) ? index : -1).filter((index) => index >= 0);
  if (indices.length !== selected.size || indices.some((index, position) => position > 0 && index !== indices[position - 1]! + 1)) return null;
  const children = sources.slice(indices[0], indices[indices.length - 1]! + 1);
  if (children.some((source) => source.kind === 'group')
    || children.some((source, index) => group.children?.[index]?.id !== source.id)) return null;
  const insertAt = indices[0]!;
  return [
    ...sources.slice(0, insertAt),
    group,
    ...sources.slice(indices[indices.length - 1]! + 1),
  ];
}

/** Replaces a top-level group with its children in the same stacking position. */
export function ungroupSourceNode(sources: readonly StreamSource[], sourceId: string): StreamSource[] | null {
  const index = sources.findIndex((source) => source.id === sourceId && source.kind === 'group');
  if (index < 0) return null;
  const group = sources[index]!;
  return [...sources.slice(0, index), ...(group.children ?? []), ...sources.slice(index + 1)];
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
  return children.map((child) => {
    if (child.kind === 'group') return child;
    const audioOnly = child.kind === 'microphone' || child.kind === 'desktop-audio' || child.kind === 'application-audio'
      || (child.kind === 'media' && child.mediaKind === 'audio');
    if (audioOnly) return child;
    return {
      ...child,
      transform: {
        x: Math.max(-32768, Math.min(32768, Math.round(to.x + (child.transform.x - from.x) * scaleX))),
        y: Math.max(-32768, Math.min(32768, Math.round(to.y + (child.transform.y - from.y) * scaleY))),
        width: Math.max(1, Math.min(32768, Math.round(child.transform.width * scaleX))),
        height: Math.max(1, Math.min(32768, Math.round(child.transform.height * scaleY))),
      },
    };
  });
}

/** Bounds non-group children in their shared scene coordinate space; empty groups have no bounds. */
export function computeGroupBoundingTransform(children: readonly StreamSource[]): SourceTransform | null {
  const leaves = children.filter((source) => source.kind !== 'group'
    && source.kind !== 'microphone' && source.kind !== 'desktop-audio' && source.kind !== 'application-audio'
    && !(source.kind === 'media' && source.mediaKind === 'audio'));
  if (leaves.length === 0) return null;

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const { transform } of leaves) {
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
