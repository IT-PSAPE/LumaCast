import { describe, expect, it } from 'vitest';
import type { SourceKind, SourceTransform, StreamSource } from '../../../../apps/stream/shared/desktop-api';
import { canGroupSourceSiblings, computeGroupBoundingTransform, findSourceSiblingSelection, flattenSourceLeaves, flattenSourceNodes, groupSourceSiblings, mapSourceTreeById, MAX_SOURCE_GROUP_DEPTH, moveSourceTreeNode, removeSceneReferenceSources, removeSourceTreeById, transformGroupChildren, ungroupSourceNode } from '../../../../apps/stream/shared/source-tree';

function makeSource(id: string, kind: SourceKind = 'image', transform: SourceTransform = { x: 0, y: 0, width: 100, height: 100 }, children?: StreamSource[]): StreamSource {
  return { id, name: id, kind, visible: true, muted: false, volume: 1, transform, ...(children ? { children } : {}) };
}

describe('Stream source tree helpers', () => {
  it('flattens group leaves in preserved stacking order', () => {
    const sceneSources = [
      makeSource('behind'),
      makeSource('group', 'group', undefined, [makeSource('group-back'), makeSource('group-front')]),
      makeSource('front'),
    ];

    expect(flattenSourceLeaves(sceneSources).map(({ id }) => id)).toEqual(['behind', 'group-back', 'group-front', 'front']);
    expect(flattenSourceNodes(sceneSources).map(({ id }) => id)).toEqual(['behind', 'group', 'group-back', 'group-front', 'front']);
  });

  it('keeps empty groups as nodes while leaf flattening and bounds return empty results', () => {
    const emptyGroup = makeSource('empty', 'group');
    expect(flattenSourceLeaves([emptyGroup])).toEqual([]);
    expect(flattenSourceNodes([emptyGroup])).toEqual([emptyGroup]);
    expect(computeGroupBoundingTransform([])).toBeNull();
  });

  it('recursively maps a matching source without changing sibling order', () => {
    const sources = [makeSource('first'), makeSource('group', 'group', undefined, [makeSource('target'), makeSource('last-child')]), makeSource('last')];
    const updated = mapSourceTreeById(sources, 'target', (source) => ({ ...source, name: 'renamed' }));

    expect(updated.map(({ id }) => id)).toEqual(['first', 'group', 'last']);
    expect(updated[1]?.children?.map(({ id, name }) => [id, name])).toEqual([['target', 'renamed'], ['last-child', 'last-child']]);
    expect(sources[1]?.children?.[0]?.name).toBe('target');
  });

  it('bounds non-group children and ignores group nodes', () => {
    const children = [
      makeSource('negative-origin', 'image', { x: -20, y: 10, width: 40, height: 30 }),
      makeSource('second', 'text', { x: 50, y: -5, width: 25, height: 15 }),
      makeSource('nested-group', 'group', { x: 1000, y: 1000, width: 100, height: 100 }),
    ];
    expect(computeGroupBoundingTransform(children)).toEqual({ x: -20, y: -5, width: 95, height: 45 });
    expect(computeGroupBoundingTransform([children[2]!])).toBeNull();
  });

  it('moves and scales grouped visual children with their bounds while preserving audio transforms', () => {
    const children = [
      makeSource('visual', 'image', { x: 10, y: 20, width: 50, height: 40 }),
      makeSource('audio', 'microphone', { x: 0, y: 0, width: 1, height: 1 }),
    ];
    const movedAndScaled = transformGroupChildren(children, { x: 10, y: 20, width: 50, height: 40 }, { x: 20, y: 10, width: 100, height: 80 });

    expect(movedAndScaled[0]?.transform).toEqual({ x: 20, y: 10, width: 100, height: 80 });
    expect(movedAndScaled[1]).toBe(children[1]);
  });

  it('moves and scales nested groups and their visual descendants as one unit', () => {
    const nested = makeSource('nested', 'group', { x: 10, y: 20, width: 30, height: 40 }, [
      makeSource('nested-child', 'image', { x: 10, y: 20, width: 30, height: 40 }),
      makeSource('nested-audio', 'microphone', { x: 0, y: 0, width: 1, height: 1 }),
    ]);

    const result = transformGroupChildren([nested], { x: 0, y: 0, width: 100, height: 100 }, { x: 100, y: 100, width: 200, height: 200 });
    expect(result[0]?.transform).toEqual({ x: 120, y: 140, width: 60, height: 80 });
    expect(result[0]?.children?.[0]?.transform).toEqual({ x: 120, y: 140, width: 60, height: 80 });
    expect(result[0]?.children?.[1]?.transform).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('recomputes group bounds after a child moves', () => {
    const group = makeSource('group', 'group', { x: 0, y: 0, width: 100, height: 100 }, [
      makeSource('child', 'image', { x: 0, y: 0, width: 50, height: 50 }),
      makeSource('other', 'image', { x: 50, y: 50, width: 50, height: 50 }),
    ]);
    const updated = mapSourceTreeById([group], 'child', (source) => ({
      ...source,
      transform: { ...source.transform, x: -20 },
    }));

    expect(updated[0]?.transform).toEqual({ x: -20, y: 0, width: 120, height: 100 });
  });

  it('groups only contiguous sibling leaves and preserves their stacking position', () => {
    const sources = [makeSource('back'), makeSource('middle'), makeSource('front')];
    const group = makeSource('group', 'group', { x: 0, y: 0, width: 100, height: 100 }, [sources[1]!, sources[2]!]);

    expect(groupSourceSiblings(sources, ['middle', 'front'], group)?.map(({ id }) => id)).toEqual(['back', 'group']);
    expect(groupSourceSiblings(sources, ['back', 'front'], group)).toBeNull();
  });

  it('groups and ungroups contiguous siblings at nested levels', () => {
    const inner = makeSource('inner', 'group', { x: 0, y: 0, width: 100, height: 100 }, [makeSource('back'), makeSource('middle'), makeSource('front')]);
    const outer = makeSource('outer', 'group', { x: 0, y: 0, width: 100, height: 100 }, [makeSource('before'), inner, makeSource('after')]);
    const selection = findSourceSiblingSelection([outer], ['back', 'middle']);
    expect(selection).toMatchObject({ parentDepth: 2, sources: [{ id: 'back' }, { id: 'middle' }] });
    expect(canGroupSourceSiblings([outer], ['back', 'middle'])).toBe(true);
    const nestedGroup = makeSource('nested-group', 'group', { x: 0, y: 0, width: 100, height: 100 }, selection?.sources);

    const grouped = groupSourceSiblings([outer], ['back', 'middle'], nestedGroup)!;
    const outerAfterGroup = grouped[0]!;
    expect(outerAfterGroup.children?.[1]?.children?.map(({ id }) => id)).toEqual(['nested-group', 'front']);
    const ungrouped = ungroupSourceNode(grouped, 'nested-group')!;
    expect(ungrouped[0]?.children?.[1]?.children?.map(({ id }) => id)).toEqual(['back', 'middle', 'front']);
  });

  it('allows grouping through the maximum depth and refuses the next level', () => {
    const makeNested = (parentDepth: number, id: string): StreamSource[] => {
      let children = [makeSource(`${id}-back`), makeSource(`${id}-front`)];
      for (let depth = 0; depth < parentDepth; depth += 1) {
        children = [makeSource(`${id}-group-${depth}`, 'group', { x: 0, y: 0, width: 100, height: 100 }, children)];
      }
      return children;
    };

    const allowedDepthSources = makeNested(MAX_SOURCE_GROUP_DEPTH - 1, 'allowed');
    const allowedIds = flattenSourceNodes(allowedDepthSources).slice(-2).map(({ id }) => id);
    const allowedSelection = findSourceSiblingSelection(allowedDepthSources, allowedIds)!;
    const allowedGroup = makeSource('allowed-new-group', 'group', computeGroupBoundingTransform(allowedSelection.sources)!, allowedSelection.sources);
    expect(canGroupSourceSiblings(allowedDepthSources, allowedIds)).toBe(true);
    expect(groupSourceSiblings(allowedDepthSources, allowedIds, allowedGroup)).not.toBeNull();

    const refusedDepthSources = makeNested(MAX_SOURCE_GROUP_DEPTH, 'refused');
    const refusedIds = flattenSourceNodes(refusedDepthSources).slice(-2).map(({ id }) => id);
    const refusedSelection = findSourceSiblingSelection(refusedDepthSources, refusedIds)!;
    const refusedGroup = makeSource('refused-new-group', 'group', computeGroupBoundingTransform(refusedSelection.sources)!, refusedSelection.sources);
    expect(canGroupSourceSiblings(refusedDepthSources, refusedIds)).toBe(false);
    expect(groupSourceSiblings(refusedDepthSources, refusedIds, refusedGroup)).toBeNull();
  });

  it('computes outer group bounds from nested descendants', () => {
    const nested = makeSource('nested', 'group', { x: 999, y: 999, width: 1, height: 1 }, [
      makeSource('left', 'image', { x: -10, y: 5, width: 20, height: 10 }),
      makeSource('right', 'image', { x: 30, y: 25, width: 15, height: 10 }),
    ]);
    expect(computeGroupBoundingTransform([nested])).toEqual({ x: -10, y: 5, width: 55, height: 30 });
  });

  it('ungroups and reorders siblings without changing source identities', () => {
    const children = [makeSource('child-back'), makeSource('child-front')];
    const group = makeSource('group', 'group', { x: 0, y: 0, width: 100, height: 100 }, children);
    const sources = [makeSource('back'), group, makeSource('front')];

    expect(ungroupSourceNode(sources, 'group')?.map(({ id }) => id)).toEqual(['back', 'child-back', 'child-front', 'front']);
    expect(moveSourceTreeNode(sources, 'group', 1).map(({ id }) => id)).toEqual(['back', 'front', 'group']);
    expect(removeSourceTreeById(sources, 'group').map(({ id }) => id)).toEqual(['back', 'front']);
  });

  it('removes references to a deleted scene, including from group children', () => {
    const childReference = makeSource('scene-source', 'scene');
    childReference.referencedSceneId = 'scene-to-delete';
    const keep = makeSource('keep', 'text');
    const group = makeSource('group', 'group', { x: 0, y: 0, width: 100, height: 100 }, [childReference, keep]);

    const result = removeSceneReferenceSources([group], 'scene-to-delete');
    expect(result[0]?.kind).toBe('group');
    expect(result[0]?.children?.map((child) => child.id)).toEqual(['keep']);
  });
});
