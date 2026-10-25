import { describe, expect, it } from 'vitest';
import { fitSplitLayoutToContainer } from '../../../../../../../apps/cast/renderer/components/layout/panel-split/split-normalize';
import type {
  SplitDefinition,
  SplitLayoutState,
} from '../../../../../../../apps/cast/renderer/components/layout/panel-split/workbench-panel-layout';

const def: SplitDefinition = {
  id: 'n',
  orientation: 'horizontal',
  paneOrder: ['left', 'mid', 'right'],
  fillPaneId: 'mid',
  panes: {
    left: { id: 'left', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true, snap: true },
    mid: { id: 'mid', defaultSize: 400, minSize: 100, maxSize: 2000, collapsible: false, snap: false },
    right: { id: 'right', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true, snap: true },
  },
};
const p = (size: number, visible = true, lastVisibleSize = size) => ({ size, visible, lastVisibleSize });
const layout = (left = p(200), mid = p(400), right = p(200)): SplitLayoutState => ({ panes: { left, mid, right } });
const visibleTotal = (l: SplitLayoutState) => Object.values(l.panes).filter((x) => x.visible).reduce((a, x) => a + x.size, 0);

describe('fitSplitLayoutToContainer', () => {
  it('returns an equal clone for non-positive or non-finite container sizes', () => {
    const input = layout();
    for (const size of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = fitSplitLayoutToContainer(def, input, size);
      expect(out).toEqual(input);
      expect(out).not.toBe(input);
    }
  });

  it('returns unchanged sizes when visible panes already sum to the container', () => {
    expect(fitSplitLayoutToContainer(def, layout(), 800)).toEqual(layout());
  });

  it('grows the fill pane first when the container is larger', () => {
    const out = fitSplitLayoutToContainer(def, layout(), 1000);
    expect(out.panes.mid).toEqual(p(600));
    expect(out.panes.left.size).toBe(200);
    expect(out.panes.right.size).toBe(200);
    expect(visibleTotal(out)).toBe(1000);
  });

  it('spills growth to panes before the fill pane, then after, once the fill pane hits maxSize', () => {
    const capped: SplitDefinition = { ...def, panes: { ...def.panes, mid: { ...def.panes.mid, maxSize: 450 } } };
    const out = fitSplitLayoutToContainer(capped, layout(), 900);
    // delta 100: mid +50 (to 450), left +50 (250), right untouched.
    expect(out.panes.mid.size).toBe(450);
    expect(out.panes.left.size).toBe(250);
    expect(out.panes.right.size).toBe(200);
  });

  it('shrinks the fill pane first when the container is smaller, down to its minSize', () => {
    const out = fitSplitLayoutToContainer(def, layout(), 650);
    expect(out.panes.mid.size).toBe(250);
    expect(visibleTotal(out)).toBe(650);
    const tight = fitSplitLayoutToContainer(def, layout(), 450);
    // deficit 350: mid -300 (to 100), left -50 (150), right untouched.
    expect(tight.panes.mid.size).toBe(100);
    expect(tight.panes.left.size).toBe(150);
    expect(tight.panes.right.size).toBe(200);
  });

  it('cannot go below the sum of minSizes; the result then overflows the container', () => {
    const out = fitSplitLayoutToContainer(def, layout(), 100);
    expect(out.panes).toEqual({ left: p(100), mid: p(100), right: p(100) });
  });

  it('cannot exceed the sum of maxSizes; the result then underfills the container', () => {
    const out = fitSplitLayoutToContainer(def, layout(), 100000);
    expect(out.panes).toEqual({ left: p(300), mid: p(2000), right: p(300) });
  });

  it('ignores hidden panes when summing and keeps them hidden at size 0 with lastVisibleSize', () => {
    const out = fitSplitLayoutToContainer(def, layout(p(0, false, 220)), 700);
    expect(out.panes.left).toEqual({ size: 0, visible: false, lastVisibleSize: 220 });
    expect(out.panes.mid.size + out.panes.right.size).toBe(700);
    expect(out.panes.mid.size).toBe(500);
  });

  it('clamps stored sizes first and mirrors the result into lastVisibleSize for visible panes', () => {
    const out = fitSplitLayoutToContainer(def, layout(p(9999, true, 5), p(400), p(200)), 800);
    expect(out.panes.left).toEqual(p(300));
    expect(out.panes.mid.size).toBe(300);
    expect(out.panes.mid.lastVisibleSize).toBe(300);
  });

  it('rounds a fractional delta to a whole number of pixels', () => {
    const out = fitSplitLayoutToContainer(def, layout(), 800.4);
    expect(out).toEqual(layout());
    const grown = fitSplitLayoutToContainer(def, layout(), 800.6);
    expect(grown.panes.mid.size).toBe(401);
  });

  it('returns the clone untouched when every pane is hidden', () => {
    const allHidden: SplitLayoutState = {
      panes: { left: p(0, false, 200), mid: p(0, false, 400), right: p(0, false, 200) },
    };
    expect(fitSplitLayoutToContainer(def, allHidden, 800)).toEqual(allHidden);
  });

  it('falls back to paneOrder when fillPaneId is not in the order', () => {
    const noFill: SplitDefinition = { ...def, fillPaneId: 'missing' };
    const out = fitSplitLayoutToContainer(noFill, layout(), 900);
    expect(out.panes.left.size).toBe(300);
    expect(out.panes.mid.size).toBe(400 + 0);
    expect(out.panes.right.size).toBe(200);
    expect(visibleTotal(out)).toBe(900);
  });

  it('does not mutate the input', () => {
    const input = layout();
    const snapshot = JSON.parse(JSON.stringify(input));
    fitSplitLayoutToContainer(def, input, 1200);
    expect(input).toEqual(snapshot);
  });
});
