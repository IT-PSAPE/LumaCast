import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, act, screen } from '@testing-library/react';
import {
  Split,
  resizeAdjacent,
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
