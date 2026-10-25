import { afterEach, describe, expect, it, vi } from 'vitest';
import { Fragment } from 'react';
import { cleanup, fireEvent, render, renderHook, act, screen } from '@testing-library/react';
import {
  Split,
  resizeAdjacent,
  resizeSplitFromDelta,
  fitSplitLayoutToContainer,
  useSplitController,
  type SplitLayout,
  type SplitPaneConfig,
} from '@lumacast/ui';

afterEach(cleanup);

const panes: SplitPaneConfig[] = [
  { id: 'a', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true, label: 'sidebar' },
  { id: 'b', defaultSize: 300, minSize: 150 },
  { id: 'c', defaultSize: 100, minSize: 50, fill: true },
];

function tree(props: Partial<React.ComponentProps<typeof Split>> = {}) {
  return (
    <Split orientation="horizontal" {...props}>
      {panes.map((p) => (
        <Split.Pane key={p.id} {...p}>
          <span>{p.id}</span>
        </Split.Pane>
      ))}
    </Split>
  );
}

const basis = (id: string) => (document.querySelector(`[data-pane-id="${id}"]`) as HTMLElement).style.flex;

describe('resizeAdjacent', () => {
  const limits = [
    { min: 100, max: 300 },
    { min: 150, max: Infinity },
  ];
  it('conserves the pair total', () => {
    expect(resizeAdjacent([200, 300], limits, 0, 40)).toEqual([240, 260]);
  });
  it('limits the delta to what both panes allow', () => {
    expect(resizeAdjacent([200, 300], limits, 0, 999)).toEqual([300, 200]);
    expect(resizeAdjacent([200, 300], limits, 0, -999)).toEqual([100, 400]);
    expect(resizeAdjacent([200, 160], limits, 0, 999)).toEqual([210, 150]);
  });
  it('does not mutate and ignores bad indices', () => {
    const sizes = [200, 300];
    resizeAdjacent(sizes, limits, 0, 10);
    expect(sizes).toEqual([200, 300]);
    expect(resizeAdjacent(sizes, limits, 5, 10)).toEqual([200, 300]);
  });
});

describe('Split', () => {
  it('renders default sizes, a handle per gap, and a fill pane', () => {
    render(tree());
    expect(basis('a')).toBe('0 0 200px');
    expect(basis('b')).toBe('0 0 300px');
    expect(basis('c')).toBe('1 1 0%');
    const handles = screen.getAllByRole('separator');
    expect(handles).toHaveLength(2);
    expect(handles[0]).toHaveAttribute('aria-label', 'Resize sidebar');
    expect(handles[0]).toHaveAttribute('aria-valuenow', '200');
  });

  it('honours min and max via keyboard in uncontrolled mode', () => {
    const onLayoutChange = vi.fn();
    render(tree({ onLayoutChange }));
    const [h0] = screen.getAllByRole('separator');
    fireEvent.keyDown(h0!, { key: 'End' });
    expect(basis('a')).toBe('0 0 300px');
    expect(basis('b')).toBe('0 0 200px');
    fireEvent.keyDown(h0!, { key: 'ArrowRight', shiftKey: true });
    expect(basis('a')).toBe('0 0 300px');
    fireEvent.keyDown(h0!, { key: 'Home' });
    expect(basis('a')).toBe('0 0 100px');
    expect(basis('b')).toBe('0 0 400px');
    const last = onLayoutChange.mock.calls.at(-1)!;
    expect(last[1]).toEqual({ phase: 'commit', reason: 'keyboard' });
  });

  it('drag emits live then commit, and the fill neighbour absorbs the change', () => {
    const onLayoutChange = vi.fn();
    render(tree({ onLayoutChange }));
    const h1 = screen.getAllByRole('separator')[1]!;
    fireEvent.pointerDown(h1, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(h1, { clientX: 40, pointerId: 1 });
    expect(basis('b')).toBe('0 0 340px');
    expect(onLayoutChange.mock.calls.at(-1)![1]).toEqual({ phase: 'live', reason: 'drag' });
    fireEvent.pointerMove(h1, { clientX: -1000, pointerId: 1 });
    expect(basis('b')).toBe('0 0 150px');
    fireEvent.pointerUp(h1, { pointerId: 1 });
    expect(onLayoutChange.mock.calls.at(-1)![1]).toEqual({ phase: 'commit', reason: 'drag' });
  });

  it('is controlled when layout is passed: no internal movement', () => {
    const layout: SplitLayout = {
      a: { size: 150, collapsed: false, restoreSize: 150 },
      b: { size: 250, collapsed: false, restoreSize: 250 },
      c: { size: 100, collapsed: false, restoreSize: 100 },
    };
    const onLayoutChange = vi.fn();
    const { rerender } = render(tree({ layout, onLayoutChange }));
    expect(basis('a')).toBe('0 0 150px');
    fireEvent.keyDown(screen.getAllByRole('separator')[0]!, { key: 'ArrowRight' });
    expect(basis('a')).toBe('0 0 150px');
    const next = onLayoutChange.mock.calls.at(-1)![0] as SplitLayout;
    expect(next.a!.size).toBe(160);
    rerender(tree({ layout: next, onLayoutChange }));
    expect(basis('a')).toBe('0 0 160px');
  });

  it('defaultLayout seeds uncontrolled state and is clamped', () => {
    render(tree({ defaultLayout: { a: { size: 9999, collapsed: false, restoreSize: 9999 } } }));
    expect(basis('a')).toBe('0 0 300px');
    expect(basis('b')).toBe('0 0 300px');
  });

  it('Enter toggles the collapsible pane and preserves restoreSize', () => {
    const onLayoutChange = vi.fn();
    render(tree({ onLayoutChange }));
    const h0 = screen.getAllByRole('separator')[0]!;
    fireEvent.keyDown(h0, { key: 'ArrowRight' });
    expect(basis('a')).toBe('0 0 210px');
    fireEvent.keyDown(h0, { key: 'Enter' });
    expect(basis('a')).toBe('0 0 0px');
    expect(onLayoutChange.mock.calls.at(-1)![0].a).toEqual({ size: 0, collapsed: true, restoreSize: 210 });
    fireEvent.keyDown(h0, { key: 'ArrowRight' });
    expect(basis('a')).toBe('0 0 0px');
    fireEvent.keyDown(h0, { key: 'Enter' });
    expect(basis('a')).toBe('0 0 210px');
    expect(onLayoutChange.mock.calls.at(-1)![0].a).toEqual({ size: 210, collapsed: false, restoreSize: 210 });
  });
});

describe('useSplitController', () => {
  it('collapse, expand, toggle and reset', () => {
    const onLayoutChange = vi.fn();
    const { result } = renderHook(() => useSplitController({ panes, onLayoutChange }));
    act(() => result.current.collapse('a'));
    expect(result.current.layout.a).toEqual({ size: 0, collapsed: true, restoreSize: 200 });
    expect(onLayoutChange).toHaveBeenLastCalledWith(expect.anything(), { phase: 'commit', reason: 'collapse' });
    act(() => result.current.collapse('b'));
    expect(result.current.layout.b!.collapsed).toBe(false);
    act(() => result.current.toggle('a'));
    expect(result.current.layout.a).toEqual({ size: 200, collapsed: false, restoreSize: 200 });
    expect(onLayoutChange).toHaveBeenLastCalledWith(expect.anything(), { phase: 'commit', reason: 'expand' });
    act(() => {
      result.current.beginResize('keyboard');
      result.current.resizeBy(0, 50);
      result.current.endResize();
    });
    expect(result.current.layout.a!.size).toBe(250);
    act(() => result.current.reset());
    expect(result.current.layout.a!.size).toBe(200);
    expect(onLayoutChange).toHaveBeenLastCalledWith(expect.anything(), { phase: 'commit', reason: 'reset' });
  });

  it('uses collapsedSize and drives a Split passed as controller', () => {
    const custom: SplitPaneConfig[] = [
      { id: 'a', defaultSize: 200, minSize: 100, collapsible: true, collapsedSize: 24 },
      { id: 'b', defaultSize: 100, minSize: 50, fill: true },
    ];
    const { result } = renderHook(() => useSplitController({ panes: custom }));
    act(() => result.current.collapse('a'));
    expect(result.current.layout.a!.size).toBe(24);
  });
});

// Ported from the cast panel-split characterization suite (split-resize / split-normalize / split-panel).
const entry = (size: number, collapsed = false, restoreSize = size) => ({ size, collapsed, restoreSize });
const lay = (config: SplitPaneConfig[], list: ReturnType<typeof entry>[]): SplitLayout =>
  Object.fromEntries(config.map((p, i) => [p.id, list[i]!]));
const sizesOf = (layout: SplitLayout, config: SplitPaneConfig[]) => config.map((p) => layout[p.id]!.size);

const plain: SplitPaneConfig[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, defaultSize: 100, minSize: 50, maxSize: 200 }));
const plainBase = lay(plain, [entry(100), entry(100), entry(100), entry(100)]);

const snapPanes: SplitPaneConfig[] = [
  { id: 'left', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true },
  { id: 'mid', defaultSize: 400, minSize: 100, maxSize: 1000, fill: true },
  { id: 'right', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true },
];
const snapBase = lay(snapPanes, [entry(200), entry(400), entry(200)]);

describe('resizeSplitFromDelta: cascade', () => {
  const run = (handle: number, delta: number, config = plain, base = plainBase) => resizeSplitFromDelta(config, base, handle, delta);

  it('a small delta moves only the adjacent panes', () => {
    const r = run(1, 30);
    expect(sizesOf(r.layout, plain)).toEqual([100, 130, 70, 100]);
    expect(r.appliedDelta).toBe(30);
    expect(sizesOf(run(1, -20).layout, plain)).toEqual([100, 80, 120, 100]);
  });

  it('spills nearest-first through the down side', () => {
    expect(sizesOf(run(1, 80).layout, plain)).toEqual([100, 180, 50, 70]);
  });

  it('spills nearest-first through the up side', () => {
    expect(sizesOf(run(1, -80).layout, plain)).toEqual([70, 50, 180, 100]);
  });

  it('caps the delta by total slack on both sides', () => {
    const r = run(0, 500);
    expect(r.appliedDelta).toBe(100);
    expect(sizesOf(r.layout, plain)).toEqual([200, 50, 50, 100]);
    expect(run(0, -90).appliedDelta).toBe(-50);
    expect(sizesOf(run(2, -500).layout, plain)).toEqual([100, 50, 50, 200]);
    expect(run(2, -120).appliedDelta).toBe(-100);
  });

  it('reaches the third pane once the limit allows it', () => {
    const wide = plain.map((p) => (p.id === 'd' ? { ...p, maxSize: 400 } : p));
    const r = resizeSplitFromDelta(wide, plainBase, 2, -120);
    expect(r.appliedDelta).toBe(-120);
    expect(sizesOf(r.layout, wide)).toEqual([80, 50, 50, 220]);
  });

  it('preserves the total at every clamp and does not mutate the input', () => {
    const snapshot = JSON.parse(JSON.stringify(plainBase));
    for (const delta of [-500, -75, 0, 40, 75, 500]) {
      expect(sizesOf(run(1, delta).layout, plain).reduce((a, b) => a + b, 0)).toBe(400);
    }
    expect(plainBase).toEqual(snapshot);
  });

  it('bad handle indices are a no-op, never a TypeError', () => {
    for (const index of [-1, 3, 99, 1.5, Number.NaN]) {
      const r = run(index, 40);
      expect(sizesOf(r.layout, plain)).toEqual([100, 100, 100, 100]);
      expect(r.appliedDelta).toBe(0);
    }
  });

  it('collapsed panes have zero slack and are skipped', () => {
    const base = lay(snapPanes, [entry(200), entry(400), entry(0, true, 200)]);
    const r = resizeSplitFromDelta(snapPanes, base, 0, -30);
    expect(sizesOf(r.layout, snapPanes)).toEqual([170, 430, 0]);
    expect(r.layout.right).toEqual({ size: 0, collapsed: true, restoreSize: 200 });
  });

  it('collapsedSize is kept as the collapsed size', () => {
    const custom = snapPanes.map((p) => (p.id === 'left' ? { ...p, collapsedSize: 24 } : p));
    expect(resizeSplitFromDelta(custom, snapBase, 0, -400).layout.left).toEqual({ size: 24, collapsed: true, restoreSize: 200 });
  });
});

describe('resizeSplitFromDelta: snap-collapse', () => {
  const run = (handle: number, delta: number, base = snapBase, config = snapPanes) => resizeSplitFromDelta(config, base, handle, delta).layout;

  it('stays at exactly half of minSize past the limit, collapses beyond (before side)', () => {
    expect(run(0, -150).left).toEqual(entry(100));
    expect(run(0, -150).mid.size).toBe(500);
    const collapsed = run(0, -151);
    expect(collapsed.left).toEqual({ size: 0, collapsed: true, restoreSize: 200 });
    expect(collapsed.mid.size).toBe(600);
    expect(collapsed.right.size).toBe(200);
  });

  it('uses the same strict boundary on the after side (cast collapses at +150; here +151)', () => {
    expect(run(1, 150).right).toEqual(entry(100));
    expect(run(1, 151).right).toEqual({ size: 0, collapsed: true, restoreSize: 200 });
    expect(run(1, 151).mid.size).toBe(600);
  });

  it('restoreSize is the size at drag start', () => {
    const start = lay(snapPanes, [entry(260), entry(340), entry(200)]);
    expect(run(0, -400, start).left).toEqual({ size: 0, collapsed: true, restoreSize: 260 });
  });

  it('re-expands once dragged back to half of minSize, restoring restoreSize (both sides)', () => {
    const collapsed = lay(snapPanes, [entry(0, true, 220), entry(600), entry(200)]);
    expect(run(0, 49, collapsed).left).toEqual({ size: 0, collapsed: true, restoreSize: 220 });
    const above = run(0, 50, collapsed).left;
    expect(above.collapsed).toBe(false);
    expect(above.size).toBeGreaterThanOrEqual(100);
    expect(above.restoreSize).toBe(above.size);
    const right = lay(snapPanes, [entry(200), entry(600), entry(0, true, 220)]);
    expect(run(1, -49, right).right.collapsed).toBe(true);
    expect(run(1, -50, right).right.collapsed).toBe(false);
  });

  it('snap: false never collapses', () => {
    const noSnap = snapPanes.map((p) => (p.id === 'left' ? { ...p, snap: false } : p));
    expect(run(0, -5000, snapBase, noSnap).left).toEqual(entry(100));
  });

  it('non-collapsible panes never collapse', () => {
    const fixed = snapPanes.map((p) => ({ ...p, collapsible: false }));
    expect(run(0, -5000, snapBase, fixed).left.collapsed).toBe(false);
  });

  it('keeps the visible total after a collapse', () => {
    expect(sizesOf(run(0, -500), snapPanes).reduce((a, b) => a + b, 0)).toBe(800);
  });
});

describe('fitSplitLayoutToContainer', () => {
  const fitPanes: SplitPaneConfig[] = [
    { id: 'left', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true },
    { id: 'mid', defaultSize: 400, minSize: 100, maxSize: 2000, fill: true },
    { id: 'right', defaultSize: 200, minSize: 100, maxSize: 300, collapsible: true },
  ];
  const base = lay(fitPanes, [entry(200), entry(400), entry(200)]);
  const visibleTotal = (l: SplitLayout) => Object.values(l).filter((x) => !x.collapsed).reduce((a, x) => a + x.size, 0);

  it('returns an equal copy for bad container sizes or unchanged totals', () => {
    for (const size of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = fitSplitLayoutToContainer(fitPanes, base, size);
      expect(out).toEqual(base);
      expect(out).not.toBe(base);
    }
    expect(fitSplitLayoutToContainer(fitPanes, base, 800)).toEqual(base);
  });

  it('grows and shrinks the fill pane first', () => {
    const grown = fitSplitLayoutToContainer(fitPanes, base, 1000);
    expect(grown.mid).toEqual(entry(600));
    expect(visibleTotal(grown)).toBe(1000);
    expect(fitSplitLayoutToContainer(fitPanes, base, 650).mid.size).toBe(250);
  });

  it('spills to panes before the fill, then after, at its limits', () => {
    const capped = fitPanes.map((p) => (p.id === 'mid' ? { ...p, maxSize: 450 } : p));
    const out = fitSplitLayoutToContainer(capped, base, 900);
    expect(sizesOf(out, fitPanes)).toEqual([250, 450, 200]);
    const tight = fitSplitLayoutToContainer(fitPanes, base, 450);
    expect(sizesOf(tight, fitPanes)).toEqual([150, 100, 200]);
  });

  it('overflows below the minimums and underfills above the maximums', () => {
    expect(sizesOf(fitSplitLayoutToContainer(fitPanes, base, 100), fitPanes)).toEqual([100, 100, 100]);
    expect(sizesOf(fitSplitLayoutToContainer(fitPanes, base, 100000), fitPanes)).toEqual([300, 2000, 300]);
  });

  it('ignores collapsed panes and keeps restoreSize', () => {
    const out = fitSplitLayoutToContainer(fitPanes, lay(fitPanes, [entry(0, true, 220), entry(400), entry(200)]), 700);
    expect(out.left).toEqual({ size: 0, collapsed: true, restoreSize: 220 });
    expect(out.mid.size).toBe(500);
    expect(out.right.size).toBe(200);
  });

  it('subtracts collapsedSize from the available space', () => {
    const custom = fitPanes.map((p) => (p.id === 'left' ? { ...p, collapsedSize: 24 } : p));
    const out = fitSplitLayoutToContainer(custom, lay(custom, [entry(24, true, 220), entry(400), entry(200)]), 724);
    expect(out.mid.size).toBe(500);
  });

  it('clamps first and mirrors the result into restoreSize', () => {
    const out = fitSplitLayoutToContainer(fitPanes, lay(fitPanes, [entry(9999, false, 5), entry(400), entry(200)]), 800);
    expect(out.left).toEqual(entry(300));
    expect(out.mid).toEqual(entry(300));
  });

  it('rounds fractional deltas', () => {
    expect(fitSplitLayoutToContainer(fitPanes, base, 800.4)).toEqual(base);
    expect(fitSplitLayoutToContainer(fitPanes, base, 800.6).mid.size).toBe(401);
  });

  it('returns the copy untouched when every pane is collapsed', () => {
    const allCollapsed = lay(fitPanes, [entry(0, true, 200), entry(0, true, 400), entry(0, true, 200)]);
    expect(fitSplitLayoutToContainer(fitPanes, allCollapsed, 800)).toEqual(allCollapsed);
  });

  it('falls back to pane order without a fill pane, and does not mutate', () => {
    const noFill = fitPanes.map((p) => ({ ...p, fill: false }));
    const snapshot = JSON.parse(JSON.stringify(base));
    const out = fitSplitLayoutToContainer(noFill, base, 900);
    expect(sizesOf(out, noFill)).toEqual([300, 400, 200]);
    expect(base).toEqual(snapshot);
  });
});

describe('Split: cascade, unmount, fragments and fit wiring', () => {
  it('resize="cascade" drags with spill and snap-collapse through the controller', () => {
    const onLayoutChange = vi.fn();
    render(
      <Split orientation="horizontal" resize="cascade" onLayoutChange={onLayoutChange}>
        {snapPanes.map((p) => (
          <Split.Pane key={p.id} {...p}>
            {p.id}
          </Split.Pane>
        ))}
      </Split>,
    );
    const h0 = screen.getAllByRole('separator')[0]!;
    fireEvent.pointerDown(h0, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(h0, { clientX: -151, pointerId: 1 });
    expect(onLayoutChange.mock.calls.at(-1)![0].left).toEqual({ size: 0, collapsed: true, restoreSize: 200 });
    fireEvent.pointerMove(h0, { clientX: -100, pointerId: 1 });
    expect(onLayoutChange.mock.calls.at(-1)![0].left.collapsed).toBe(false);
    fireEvent.pointerUp(h0, { pointerId: 1 });
  });

  it('adjacent mode is still the default (no spill into non-adjacent panes)', () => {
    const { result } = renderHook(() => useSplitController({ panes: plain }));
    act(() => {
      result.current.beginResize('keyboard');
      result.current.resizeBy(0, 500);
      result.current.endResize();
    });
    expect(sizesOf(result.current.layout, plain)).toEqual([150, 50, 100, 100]);
  });

  it('unmountWhenCollapsed removes the pane; the default keeps it mounted', () => {
    const withPanes = (unmount: boolean) => (
      <Split orientation="horizontal" defaultLayout={{ a: entry(0, true, 200) }}>
        <Split.Pane id="a" defaultSize={200} minSize={100} collapsible unmountWhenCollapsed={unmount}>
          <span data-testid="a-body" />
        </Split.Pane>
        <Split.Pane id="b" defaultSize={100} minSize={50} fill>
          b
        </Split.Pane>
      </Split>
    );
    const { unmount } = render(withPanes(true));
    expect(document.querySelector('[data-pane-id="a"]')).toBeNull();
    expect(screen.queryByTestId('a-body')).toBeNull();
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    unmount();
    render(withPanes(false));
    expect(document.querySelector('[data-pane-id="a"]')).not.toBeNull();
    expect(screen.getByTestId('a-body')).toBeInTheDocument();
  });

  it('unmountWhenCollapsed keeps an empty wrapper when collapsedSize reserves space', () => {
    render(
      <Split orientation="horizontal" defaultLayout={{ a: entry(24, true, 200) }}>
        <Split.Pane id="a" defaultSize={200} minSize={100} collapsible collapsedSize={24} unmountWhenCollapsed>
          <span data-testid="a-body" />
        </Split.Pane>
        <Split.Pane id="b" defaultSize={100} minSize={50} fill>
          b
        </Split.Pane>
      </Split>,
    );
    expect(basis('a')).toBe('0 0 24px');
    expect(screen.queryByTestId('a-body')).toBeNull();
  });

  it('collects panes wrapped in Fragments', () => {
    render(
      <Split orientation="horizontal">
        <>
          <Split.Pane id="a" defaultSize={200} minSize={100}>
            a
          </Split.Pane>
          <Fragment>
            <Split.Pane id="b" defaultSize={100} minSize={50} fill>
              b
            </Split.Pane>
          </Fragment>
        </>
      </Split>,
    );
    expect(basis('a')).toBe('0 0 200px');
    expect(basis('b')).toBe('1 1 0%');
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('fitToContainer fits on resize and reports reason "fit"; off by default', () => {
    let notify: () => void = () => {};
    class FakeObserver {
      constructor(cb: () => void) {
        notify = cb;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    try {
      const onLayoutChange = vi.fn();
      render(tree({ fitToContainer: true, onLayoutChange }));
      act(() => notify());
      // a 200 + b 300 + c 100 = 600; the fill pane (c) grows by 300.
      const [layout, meta] = onLayoutChange.mock.calls.at(-1)!;
      expect(meta).toEqual({ phase: 'commit', reason: 'fit' });
      expect(layout.c.size).toBe(400);
      onLayoutChange.mockClear();
      act(() => notify());
      expect(onLayoutChange).not.toHaveBeenCalled();
      cleanup();
      render(tree({ onLayoutChange }));
      act(() => notify());
      expect(onLayoutChange).not.toHaveBeenCalled();
    } finally {
      width.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
