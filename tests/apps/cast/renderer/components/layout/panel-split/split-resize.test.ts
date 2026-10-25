import { describe, expect, it } from 'vitest';
import {
  applyMeasuredPaneSizes,
  coerceSplitLayout,
  createDefaultSplitLayout,
  resizeSplitFromDelta,
  setPaneVisibility,
} from '../../../../../../../apps/cast/renderer/components/layout/panel-split/split-resize';
import type {
  SplitDefinition,
  SplitLayoutState,
} from '../../../../../../../apps/cast/renderer/components/layout/panel-split/workbench-panel-layout';

const sizes = (layout: SplitLayoutState, order: string[]) => order.map((id) => layout.panes[id].size);
const pane = (size: number, visible = true, lastVisibleSize = size) => ({ size, visible, lastVisibleSize });

// Three plain panes, no collapse: cascade tests.
const plain: SplitDefinition = {
  id: 'plain',
  orientation: 'horizontal',
  paneOrder: ['a', 'b', 'c', 'd'],
  fillPaneId: 'd',
  panes: {
    a: { id: 'a', defaultSize: 100, minSize: 50, maxSize: 200, collapsible: false, snap: false },
    b: { id: 'b', defaultSize: 100, minSize: 50, maxSize: 200, collapsible: false, snap: false },
    c: { id: 'c', defaultSize: 100, minSize: 50, maxSize: 200, collapsible: false, snap: false },
    d: { id: 'd', defaultSize: 100, minSize: 50, maxSize: 200, collapsible: false, snap: false },
  },
};
const plainOrder = plain.paneOrder;

// Collapsible/snap pane on each side of a fixed middle.
const snapDef: SplitDefinition = {
  id: 'snap',
  orientation: 'horizontal',
  paneOrder: ['left', 'mid', 'right'],
  fillPaneId: 'mid',
  panes: {
    left: { id: 'left', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true, snap: true },
    mid: { id: 'mid', defaultSize: 400, minSize: 100, maxSize: 1000, collapsible: false, snap: false },
    right: { id: 'right', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true, snap: true },
  },
};
const snapOrder = snapDef.paneOrder;

describe('createDefaultSplitLayout', () => {
  it('uses defaultSize for size and lastVisibleSize and marks every pane visible', () => {
    expect(createDefaultSplitLayout(snapDef).panes).toEqual({
      left: pane(200),
      mid: pane(400),
      right: pane(200),
    });
  });
});

describe('coerceSplitLayout', () => {
  const fallback = createDefaultSplitLayout(snapDef);

  it('clamps size and lastVisibleSize into [minSize, maxSize]', () => {
    const out = coerceSplitLayout(snapDef, { panes: { left: pane(10, true, 9999), mid: pane(5000), right: pane(150) } }, fallback);
    expect(out.panes.left).toEqual({ size: 100, visible: true, lastVisibleSize: 300 });
    expect(out.panes.mid.size).toBe(1000);
    expect(out.panes.right.size).toBe(150);
  });

  it('forces size 0 for a hidden collapsible pane but keeps its clamped lastVisibleSize', () => {
    const out = coerceSplitLayout(snapDef, { panes: { left: pane(250, false, 250), mid: pane(400), right: pane(200) } }, fallback);
    expect(out.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 250 });
  });

  it('forces a non-collapsible pane visible even if persisted as hidden', () => {
    const out = coerceSplitLayout(snapDef, { panes: { left: pane(200), mid: pane(0, false, 300), right: pane(200) } }, fallback);
    expect(out.panes.mid).toEqual({ size: 100, visible: true, lastVisibleSize: 300 });
  });

  it('falls back per pane for missing panes and wrong-typed fields', () => {
    const out = coerceSplitLayout(
      snapDef,
      { panes: { left: { size: 'x', visible: 'no', lastVisibleSize: null } } } as unknown as SplitLayoutState,
      fallback,
    );
    expect(out.panes).toEqual(fallback.panes);
  });

  it('drops panes not in the definition', () => {
    const out = coerceSplitLayout(snapDef, { panes: { ...fallback.panes, ghost: pane(10) } }, fallback);
    expect(Object.keys(out.panes)).toEqual(snapOrder);
  });

  it('throws when the definition has no pane definition for an ordered pane', () => {
    const broken = { ...snapDef, paneOrder: ['left', 'nope'] };
    expect(() => coerceSplitLayout(broken, fallback, fallback)).toThrow('Missing split state for pane: nope');
  });
});

describe('applyMeasuredPaneSizes', () => {
  it('writes clamped measured sizes into size and lastVisibleSize for visible panes', () => {
    const base = createDefaultSplitLayout(snapDef);
    const out = applyMeasuredPaneSizes(snapDef, base, { left: 50, mid: 640, right: 120 });
    expect(out.panes.left).toEqual(pane(100));
    expect(out.panes.mid).toEqual(pane(640));
    expect(out.panes.right).toEqual(pane(120));
  });

  it('skips hidden panes, NaN and non-number measurements, and does not mutate the input', () => {
    const base: SplitLayoutState = { panes: { left: pane(0, false, 222), mid: pane(400), right: pane(200) } };
    const snapshot = JSON.parse(JSON.stringify(base));
    const out = applyMeasuredPaneSizes(snapDef, base, { left: 150, mid: Number.NaN });
    expect(out.panes.left).toEqual(pane(0, false, 222));
    expect(out.panes.mid).toEqual(pane(400));
    expect(out.panes.right).toEqual(pane(200));
    expect(base).toEqual(snapshot);
  });
});

describe('setPaneVisibility', () => {
  it('hiding stores size 0 and retains lastVisibleSize', () => {
    const out = setPaneVisibility(snapDef, createDefaultSplitLayout(snapDef), 'left', false);
    expect(out.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 200 });
  });

  it('showing restores lastVisibleSize', () => {
    const hidden: SplitLayoutState = { panes: { left: pane(0, false, 250), mid: pane(400), right: pane(200) } };
    const out = setPaneVisibility(snapDef, hidden, 'left', true);
    expect(out.panes.left).toEqual(pane(250));
  });

  it('is a no-op for a non-collapsible pane', () => {
    const base = createDefaultSplitLayout(snapDef);
    expect(setPaneVisibility(snapDef, base, 'mid', false)).toEqual(base);
  });

  it('is a no-op when visibility already matches', () => {
    const base = createDefaultSplitLayout(snapDef);
    expect(setPaneVisibility(snapDef, base, 'left', true)).toEqual(base);
  });

  it('hiding a pane below minSize records lastVisibleSize as at least minSize', () => {
    const base: SplitLayoutState = { panes: { left: pane(40, true, 40), mid: pane(400), right: pane(200) } };
    const out = setPaneVisibility(snapDef, base, 'left', false);
    expect(out.panes.left.lastVisibleSize).toBe(100);
  });
});

describe('resizeSplitFromDelta: adjacent-pair and clamping', () => {
  const base = createDefaultSplitLayout(plain);

  it('a small delta moves only the panes adjacent to the handle', () => {
    const { layout, appliedDelta } = resizeSplitFromDelta(plain, base, 1, 30);
    expect(sizes(layout, plainOrder)).toEqual([100, 130, 70, 100]);
    expect(appliedDelta).toBe(30);
  });

  it('a negative delta shrinks the pane before the handle and grows the one after', () => {
    const { layout, appliedDelta } = resizeSplitFromDelta(plain, base, 1, -20);
    expect(sizes(layout, plainOrder)).toEqual([100, 80, 120, 100]);
    expect(appliedDelta).toBe(-20);
  });

  it('delta 0 leaves sizes unchanged', () => {
    const { layout, appliedDelta } = resizeSplitFromDelta(plain, base, 0, 0);
    expect(sizes(layout, plainOrder)).toEqual([100, 100, 100, 100]);
    expect(appliedDelta).toBe(0);
  });

  it('handle index -1 or the last pane index is a no-op returning appliedDelta 0', () => {
    for (const idx of [-1, 3]) {
      const { layout, appliedDelta } = resizeSplitFromDelta(plain, base, idx, 40);
      expect(sizes(layout, plainOrder)).toEqual([100, 100, 100, 100]);
      expect(appliedDelta).toBe(0);
    }
  });

  it('PINNED DEFECT: a handle index beyond the pane count throws a TypeError instead of hitting the resize() guard', () => {
    // resize() guards handleIndex >= length - 1, but findFirstSnapIndex dereferences items[index] first.
    expect(() => resizeSplitFromDelta(plain, base, 99, 40)).toThrow(TypeError);
  });

  it('does not mutate the input layout', () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    resizeSplitFromDelta(plain, base, 1, 60);
    expect(base).toEqual(snapshot);
  });

  it('total of all panes is preserved while clamped', () => {
    for (const delta of [-500, -75, 0, 40, 75, 500]) {
      const { layout } = resizeSplitFromDelta(plain, base, 1, delta);
      expect(sizes(layout, plainOrder).reduce((a, b) => a + b, 0)).toBe(400);
    }
  });
});

describe('resizeSplitFromDelta: cascading propagation (differs from the package adjacent-pair model)', () => {
  const base = createDefaultSplitLayout(plain);

  it('growing the handle-before side beyond the adjacent pane spills into the pane after the adjacent one', () => {
    // handle 1 sits between b and c. c can give 50 (100->50); the rest (d) gives the remainder.
    // Positive delta: a,b grow (up side, nearest first); c,d shrink (down side, nearest first).
    const { layout, appliedDelta } = resizeSplitFromDelta(plain, base, 1, 80);
    // up: b +80 -> 180 (within max 200), a untouched. down: c -80 clamps at 50 (-50), d absorbs -30.
    expect(sizes(layout, plainOrder)).toEqual([100, 180, 50, 70]);
    expect(appliedDelta).toBe(80);
  });

  it('shrinking the up side cascades to panes before the adjacent one', () => {
    // negative delta -80: up side (b,a) shrink, nearest first. b 100->50 (-50), a absorbs -30. down side: c grows +80.
    const { layout, appliedDelta } = resizeSplitFromDelta(plain, base, 1, -80);
    expect(sizes(layout, plainOrder)).toEqual([70, 50, 180, 100]);
    expect(appliedDelta).toBe(-80);
  });

  it('growth cascades across the down side when the nearest down pane hits its maxSize', () => {
    // handle 0, delta -90: a shrinks 100->50 (-50) then no further up panes; delta clamps to minDelta.
    const { layout, appliedDelta } = resizeSplitFromDelta(plain, base, 0, -90);
    expect(appliedDelta).toBe(-50);
    expect(sizes(layout, plainOrder)).toEqual([50, 150, 100, 100]);
  });

  it('clamps the overall delta to the total slack of the down side', () => {
    // down slack = 50*3 = 150, up capacity = 200-100 = 100 (pane a only) -> delta 100.
    // down side applies nearest-first: b -50 (to min), remainder cascades: c -50, d untouched.
    const { layout, appliedDelta } = resizeSplitFromDelta(plain, base, 0, 500);
    expect(appliedDelta).toBe(100);
    expect(sizes(layout, plainOrder)).toEqual([200, 50, 50, 100]);
  });

  it('clamps overall delta to the up-side slack when handle is the last one', () => {
    // handle 2 (c|d): up = c,b,a each can shrink 50 -> 150 slack; d can grow only +100 (max 200).
    // Delta -100: c -50 (min), remainder cascades to b -50 (min); a untouched.
    const { layout, appliedDelta } = resizeSplitFromDelta(plain, base, 2, -500);
    expect(appliedDelta).toBe(-100);
    expect(sizes(layout, plainOrder)).toEqual([100, 50, 50, 200]);
  });

  it('delta spreads over multiple up panes in nearest-first order once the nearest saturates', () => {
    // d's growth capacity (100) caps the delta, so a (third in the cascade) is not reached.
    const { layout, appliedDelta } = resizeSplitFromDelta(plain, base, 2, -120);
    expect(appliedDelta).toBe(-100);
    expect(sizes(layout, plainOrder)).toEqual([100, 50, 50, 200]);
  });

  it('a delta within slack that exceeds the adjacent pane reaches the third pane (a)', () => {
    // widen d's headroom so only the up side limits: d max 400.
    const wide: SplitDefinition = { ...plain, panes: { ...plain.panes, d: { ...plain.panes.d, maxSize: 400 } } };
    const { layout, appliedDelta } = resizeSplitFromDelta(wide, createDefaultSplitLayout(wide), 2, -120);
    expect(appliedDelta).toBe(-120);
    expect(sizes(layout, plainOrder)).toEqual([80, 50, 50, 220]);
  });

  it('hidden collapsible panes have zero slack and are skipped by the cascade', () => {
    const hiddenMid: SplitLayoutState = { panes: { left: pane(200), mid: pane(400), right: pane(0, false, 200) } };
    const { layout } = resizeSplitFromDelta(snapDef, hiddenMid, 0, -30);
    expect(sizes(layout, snapOrder)).toEqual([170, 430, 0]);
    expect(layout.panes.right).toEqual({ size: 0, visible: false, lastVisibleSize: 200 });
  });
});

describe('resizeSplitFromDelta: snap-collapse', () => {
  const base = createDefaultSplitLayout(snapDef);
  // left: 200 (min 100). Dragging the handle after left (index 0) left by more than
  // (200-100) + floor(100/2) = 150 collapses it.

  it('stays visible at exactly the limit (delta -150)', () => {
    const { layout } = resizeSplitFromDelta(snapDef, base, 0, -150);
    expect(layout.panes.left).toEqual(pane(100));
    expect(layout.panes.mid.size).toBe(500);
  });

  it('collapses when dragged below half of minSize: size 0, lastVisibleSize retained, space goes to the neighbour', () => {
    const { layout } = resizeSplitFromDelta(snapDef, base, 0, -151);
    expect(layout.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 200 });
    expect(layout.panes.mid.size).toBe(600);
    expect(layout.panes.right.size).toBe(200);
  });

  it('lastVisibleSize records the size at drag start, not the size reached when it collapsed', () => {
    const start: SplitLayoutState = { panes: { left: pane(260), mid: pane(340), right: pane(200) } };
    const { layout } = resizeSplitFromDelta(snapDef, start, 0, -400);
    expect(layout.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 260 });
  });

  it('re-expands from collapsed once dragged back past the threshold, restoring lastVisibleSize', () => {
    const collapsed: SplitLayoutState = { panes: { left: pane(0, false, 220), mid: pane(600), right: pane(200) } };
    const below = resizeSplitFromDelta(snapDef, collapsed, 0, 49);
    expect(below.layout.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 220 });
    const above = resizeSplitFromDelta(snapDef, collapsed, 0, 50);
    expect(above.layout.panes.left.visible).toBe(true);
    expect(above.layout.panes.left.size).toBeGreaterThanOrEqual(100);
    expect(above.layout.panes.left.lastVisibleSize).toBe(above.layout.panes.left.size);
  });

  it('collapses a snap pane on the after side of the handle when dragged right past the threshold', () => {
    // right: 200, min 100. handle 1 dragged right by 150 collapses it (>=), whereas the before side
    // needs -151 (>): the two thresholds are off by one from each other.
    const near = resizeSplitFromDelta(snapDef, base, 1, 149);
    expect(near.layout.panes.right).toEqual(pane(100));
    const far = resizeSplitFromDelta(snapDef, base, 1, 150);
    expect(far.layout.panes.right).toEqual({ size: 0, visible: false, lastVisibleSize: 200 });
    expect(far.layout.panes.mid.size).toBe(600);
  });

  it('a pane with snap: false never collapses however far it is dragged', () => {
    const noSnap: SplitDefinition = {
      ...snapDef,
      panes: { ...snapDef.panes, left: { ...snapDef.panes.left, snap: false } },
    };
    const { layout } = resizeSplitFromDelta(noSnap, base, 0, -5000);
    expect(layout.panes.left).toEqual(pane(100));
  });

  it('visible sizes still add up to the total after a collapse', () => {
    const { layout } = resizeSplitFromDelta(snapDef, base, 0, -500);
    expect(sizes(layout, snapOrder).reduce((a, b) => a + b, 0)).toBe(800);
  });
});
