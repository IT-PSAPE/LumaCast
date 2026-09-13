import { describe, expect, it } from 'vitest';
import {
  alignElements,
  distributeElements,
  elementBounds,
  groupElements,
  ungroupElement,
  unionBounds,
  type AlignEdge,
  type AlignTarget,
} from '../../../../packages/composition/src/element-geometry';
import type { GroupElementPayload, ShapeElementPayload, SlideElement } from '../../../../packages/composition/src/domain/slide-elements';

let nextId = 0;

function shape(overrides: Partial<SlideElement> = {}): SlideElement {
  nextId += 1;
  const payload: ShapeElementPayload = {
    fillColor: '#ffffff',
    borderColor: '#000000',
    borderWidth: 1,
    borderRadius: 0,
  };
  return {
    id: `el-${nextId}`,
    slideId: 'slide-1',
    type: 'shape',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    layer: 'content',
    payload,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const SLIDE = { width: 1920, height: 1080 };

describe('elementBounds', () => {
  it('returns the element box unchanged when unrotated', () => {
    const el = shape({ x: 10, y: 20, width: 100, height: 50 });
    expect(elementBounds(el)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('computes the axis-aligned box of a rotated element, pivoting on (x, y)', () => {
    // A 100x50 box rotated 90° clockwise around its own (x, y) anchor sweeps
    // from (0, 0) to (-50, 100) in local terms, i.e. absolute x in [-50, 0],
    // y in [0, 100] once anchored at (0, 0).
    const el = shape({ x: 0, y: 0, width: 100, height: 50, rotation: 90 });
    const bounds = elementBounds(el);
    expect(bounds.x).toBeCloseTo(-50, 6);
    expect(bounds.y).toBeCloseTo(0, 6);
    expect(bounds.width).toBeCloseTo(50, 6);
    expect(bounds.height).toBeCloseTo(100, 6);
  });

  it('computes the axis-aligned box of a 45°-rotated square', () => {
    const el = shape({ x: 100, y: 100, width: 40, height: 40, rotation: 45 });
    const bounds = elementBounds(el);
    const diagonal = Math.sqrt(2) * 40;
    expect(bounds.width).toBeCloseTo(diagonal, 6);
    expect(bounds.height).toBeCloseTo(diagonal, 6);
  });
});

describe('unionBounds', () => {
  it('returns null for an empty list', () => {
    expect(unionBounds([])).toBeNull();
  });

  it('unions several boxes into their bounding rectangle', () => {
    const bounds = unionBounds([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 5, width: 10, height: 30 },
      { x: -5, y: -5, width: 5, height: 5 },
    ]);
    expect(bounds).toEqual({ x: -5, y: -5, width: 35, height: 40 });
  });
});

describe('alignElements', () => {
  const edges: AlignEdge[] = ['left', 'centerX', 'right', 'top', 'centerY', 'bottom'];
  const targets: AlignTarget[] = ['selection', 'slide'];

  it('is a no-op for a single element aligned to the selection', () => {
    const el = shape({ x: 50, y: 50 });
    const result = alignElements([el], 'left', 'selection', SLIDE);
    expect(result[0]).toEqual(el);
  });

  it('is a no-op for an empty list', () => {
    expect(alignElements([], 'left', 'slide', SLIDE)).toEqual([]);
  });

  for (const target of targets) {
    for (const edge of edges) {
      it(`aligns ${edge} against ${target}`, () => {
        const a = shape({ x: 10, y: 30, width: 100, height: 40 });
        const b = shape({ x: 400, y: 300, width: 60, height: 20 });
        const elements = target === 'selection' ? [a, b] : [a];
        const result = alignElements(elements, edge, target, SLIDE);
        const reference = target === 'slide'
          ? { x: 0, y: 0, width: SLIDE.width, height: SLIDE.height }
          : unionBounds(elements.map(elementBounds))!;

        for (const updated of result) {
          const bounds = elementBounds(updated);
          if (edge === 'left') expect(bounds.x).toBeCloseTo(reference.x, 6);
          if (edge === 'right') expect(bounds.x + bounds.width).toBeCloseTo(reference.x + reference.width, 6);
          if (edge === 'centerX') expect(bounds.x + bounds.width / 2).toBeCloseTo(reference.x + reference.width / 2, 6);
          if (edge === 'top') expect(bounds.y).toBeCloseTo(reference.y, 6);
          if (edge === 'bottom') expect(bounds.y + bounds.height).toBeCloseTo(reference.y + reference.height, 6);
          if (edge === 'centerY') expect(bounds.y + bounds.height / 2).toBeCloseTo(reference.y + reference.height / 2, 6);
        }
      });
    }
  }

  it('preserves rotation and size, only translating position', () => {
    const el = shape({ x: 10, y: 30, width: 100, height: 40, rotation: 30 });
    const [result] = alignElements([el], 'left', 'slide', SLIDE);
    expect(result.rotation).toBe(30);
    expect(result.width).toBe(100);
    expect(result.height).toBe(40);
  });
});

describe('distributeElements', () => {
  it('is a no-op for fewer than 3 elements', () => {
    const a = shape({ x: 0 });
    const b = shape({ x: 100 });
    expect(distributeElements([a], 'horizontal')).toEqual([a]);
    expect(distributeElements([a, b], 'horizontal')).toEqual([a, b]);
  });

  it('spaces 3+ elements evenly along the horizontal axis, keeping first/last fixed', () => {
    const a = shape({ x: 0, width: 20 });
    const b = shape({ x: 500, width: 40 });
    const c = shape({ x: 1000, width: 60 });
    const result = distributeElements([a, b, c], 'horizontal');

    expect(result[0]).toEqual(a);
    expect(result[2]).toEqual(c);

    const gapBefore = result[1].x - (a.x + a.width);
    const gapAfter = c.x - (result[1].x + result[1].width);
    expect(gapBefore).toBeCloseTo(gapAfter, 6);
  });

  it('spaces evenly along the vertical axis', () => {
    const a = shape({ y: 0, height: 20 });
    const b = shape({ y: 500, height: 40 });
    const c = shape({ y: 1000, height: 60 });
    const result = distributeElements([a, b, c], 'vertical');

    const gapBefore = result[1].y - (a.y + a.height);
    const gapAfter = c.y - (result[1].y + result[1].height);
    expect(gapBefore).toBeCloseTo(gapAfter, 6);
    expect(result[1].x).toBe(b.x);
  });

  it('orders by position rather than input order, but returns elements in input order', () => {
    const c = shape({ x: 1000, width: 60 });
    const a = shape({ x: 0, width: 20 });
    const b = shape({ x: 500, width: 40 });
    // Input order is c, a, b — the function must still treat a/b/c as
    // ordered by x (a, b, c) when computing gaps, so a and c (the leftmost
    // and rightmost by position) stay fixed and only b may move.
    const result = distributeElements([c, a, b], 'horizontal');
    expect(result.map((el) => el.id)).toEqual([c.id, a.id, b.id]);
    expect(result.find((el) => el.id === c.id)).toEqual(c);
    expect(result.find((el) => el.id === a.id)).toEqual(a);
  });
});

describe('groupElements / ungroupElement round trip', () => {
  it('creates a group at the union bounds with children re-based to group-relative coordinates', () => {
    const a = shape({ x: 10, y: 20, width: 100, height: 50, zIndex: 0 });
    const b = shape({ x: 200, y: 10, width: 40, height: 40, zIndex: 1 });
    const group = groupElements([a, b], { id: 'group-1', zIndex: 5 });

    expect(group.type).toBe('group');
    expect(group.id).toBe('group-1');
    expect(group.zIndex).toBe(5);
    expect(group.rotation).toBe(0);
    expect(group.x).toBe(10);
    expect(group.y).toBe(10);
    expect(group.width).toBe(230); // union right edge 240 (200+40) minus left edge 10
    expect(group.height).toBe(60); // union bottom edge 70 (20+50) minus top edge 10

    const payload = group.payload as GroupElementPayload;
    expect(payload.children).toHaveLength(2);
    const childA = payload.children.find((c) => c.id === a.id)!;
    const childB = payload.children.find((c) => c.id === b.id)!;
    expect(childA.x).toBeCloseTo(a.x - group.x, 6);
    expect(childA.y).toBeCloseTo(a.y - group.y, 6);
    expect(childB.x).toBeCloseTo(b.x - group.x, 6);
    expect(childB.y).toBeCloseTo(b.y - group.y, 6);
    // rotation/size preserved
    expect(childA.width).toBe(a.width);
    expect(childA.height).toBe(a.height);
    expect(childA.rotation).toBe(a.rotation);
  });

  it('sets a name when provided', () => {
    const a = shape();
    const b = shape();
    const group = groupElements([a, b], { id: 'group-2', zIndex: 0, name: 'My Group' });
    expect((group.payload as GroupElementPayload).name).toBe('My Group');
  });

  it('round trips: grouping then ungrouping restores absolute positions within 1e-6', () => {
    const a = shape({ x: 15, y: 25, width: 120, height: 60, rotation: 10 });
    const b = shape({ x: 300, y: 80, width: 50, height: 50, rotation: -20 });
    const c = shape({ x: 150, y: 400, width: 30, height: 90 });
    const originals = [a, b, c];

    const group = groupElements(originals, { id: 'group-3', zIndex: 2 });
    const restored = ungroupElement(group);

    for (const original of originals) {
      const match = restored.find((el) => el.id === original.id)!;
      expect(match).toBeDefined();
      expect(match.x).toBeCloseTo(original.x, 6);
      expect(match.y).toBeCloseTo(original.y, 6);
      expect(match.width).toBeCloseTo(original.width, 6);
      expect(match.height).toBeCloseTo(original.height, 6);
      expect(match.rotation).toBeCloseTo(original.rotation, 6);
    }
  });

  it('composes group rotation onto ungrouped children', () => {
    // a sits exactly at the group's own (x, y) anchor (group-local 0,0) —
    // rotation pivots there, so a is expected to stay put. b is offset from
    // the anchor and must swing around it.
    const a = shape({ x: 10, y: 0, width: 20, height: 20, rotation: 0 });
    const b = shape({ x: 10, y: 100, width: 20, height: 20, rotation: 0 });
    const group = groupElements([a, b], { id: 'group-4', zIndex: 0 });
    expect(group.x).toBe(10);
    expect(group.y).toBe(0);
    const rotatedGroup: SlideElement = { ...group, rotation: 90 };

    const restored = ungroupElement(rotatedGroup);
    for (const child of restored) {
      expect(child.rotation).toBeCloseTo(90, 6);
    }
    const childA = restored.find((el) => el.id === a.id)!;
    const childB = restored.find((el) => el.id === b.id)!;
    // childA is at the group's local origin: a 90° rotation around its own
    // anchor leaves it in place.
    expect(childA.x).toBeCloseTo(a.x, 6);
    expect(childA.y).toBeCloseTo(a.y, 6);
    // childB (group-local (0, 100)) swings to group-local (-100, 0), i.e.
    // absolute (group.x - 100, group.y).
    expect(childB.x).toBeCloseTo(group.x - 100, 6);
    expect(childB.y).toBeCloseTo(group.y, 6);
  });

  it('returns the child in place for a group with a single child', () => {
    const a = shape({ x: 5, y: 5, width: 10, height: 10 });
    const group = groupElements([a], { id: 'group-5', zIndex: 0 });
    const restored = ungroupElement(group);
    expect(restored).toHaveLength(1);
    expect(restored[0].x).toBeCloseTo(a.x, 6);
    expect(restored[0].y).toBeCloseTo(a.y, 6);
  });

  it('passes non-group elements through unchanged', () => {
    const a = shape();
    expect(ungroupElement(a)).toEqual([a]);
  });

  it('handles a nested group inside a group: the inner group is treated as an opaque element', () => {
    const innerChildA = shape({ x: 0, y: 0, width: 20, height: 20 });
    const innerChildB = shape({ x: 30, y: 0, width: 20, height: 20 });
    const innerGroup = groupElements([innerChildA, innerChildB], { id: 'inner-group', zIndex: 0 });

    const sibling = shape({ x: 200, y: 200, width: 50, height: 50 });
    const outerGroup = groupElements([innerGroup, sibling], { id: 'outer-group', zIndex: 0 });

    const outerPayload = outerGroup.payload as GroupElementPayload;
    const nestedInner = outerPayload.children.find((c) => c.id === 'inner-group')!;
    expect(nestedInner.type).toBe('group');
    // The inner group's own children stay relative to ITS frame, untouched.
    const nestedInnerPayload = nestedInner.payload as GroupElementPayload;
    expect(nestedInnerPayload.children).toHaveLength(2);
    expect(nestedInnerPayload.children.find((c) => c.id === innerChildA.id)!.x).toBeCloseTo(innerChildA.x - innerGroup.x, 6);

    // Ungrouping the outer group lifts the inner group (still intact, with
    // its own children untouched) to absolute coordinates.
    const restoredOuterChildren = ungroupElement(outerGroup);
    const restoredInnerGroup = restoredOuterChildren.find((el) => el.id === 'inner-group')!;
    expect(restoredInnerGroup.type).toBe('group');
    expect(restoredInnerGroup.x).toBeCloseTo(innerGroup.x, 6);
    expect(restoredInnerGroup.y).toBeCloseTo(innerGroup.y, 6);
    expect((restoredInnerGroup.payload as GroupElementPayload).children).toHaveLength(2);
  });
});
