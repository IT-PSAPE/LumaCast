import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SplitPanel, usePanelRoute } from '../../../../../../../apps/cast/renderer/components/layout/panel-split/split-panel';

const STORAGE_KEY = 'lumacast.workbench-layout.v1';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function renderSplit(panels: ReactNode, orientation: 'horizontal' | 'vertical' = 'horizontal') {
  return render(
    <SplitPanel>
      <SplitPanel.Panel splitId="s" orientation={orientation} data-testid="split">
        {panels}
      </SplitPanel.Panel>
    </SplitPanel>,
  );
}

const pane = (id: string) => document.querySelector(`[data-pane-id="${id}"]`) as HTMLElement | null;
const flexible = (id: string) => pane(id)!.style.flexGrow === '1';

describe('fill pane derivation (getFillPaneId, observed via flexGrow)', () => {
  it('the single non-collapsible pane fills, wherever it sits', () => {
    renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={200} minSize={100} collapsible>a</SplitPanel.Segment>,
        <SplitPanel.Segment key="b" id="b" defaultSize={300} minSize={100}>b</SplitPanel.Segment>,
        <SplitPanel.Segment key="c" id="c" defaultSize={200} minSize={100} collapsible>c</SplitPanel.Segment>,
      ],
    );
    expect([flexible('a'), flexible('b'), flexible('c')]).toEqual([false, true, false]);
  });

  it('the first pane fills when it is the only non-collapsible one', () => {
    renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={300} minSize={100}>a</SplitPanel.Segment>,
        <SplitPanel.Segment key="b" id="b" defaultSize={200} minSize={100} collapsible>b</SplitPanel.Segment>,
      ],
    );
    expect([flexible('a'), flexible('b')]).toEqual([true, false]);
  });

  it('with several non-collapsible panes the LAST pane fills', () => {
    renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={200} minSize={100}>a</SplitPanel.Segment>,
        <SplitPanel.Segment key="b" id="b" defaultSize={200} minSize={100}>b</SplitPanel.Segment>,
        <SplitPanel.Segment key="c" id="c" defaultSize={200} minSize={100}>c</SplitPanel.Segment>,
      ],
    );
    expect([flexible('a'), flexible('b'), flexible('c')]).toEqual([false, false, true]);
  });

  it('with no non-collapsible pane the last pane fills', () => {
    renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={200} minSize={100} collapsible>a</SplitPanel.Segment>,
        <SplitPanel.Segment key="b" id="b" defaultSize={200} minSize={100} collapsible>b</SplitPanel.Segment>,
      ],
    );
    expect([flexible('a'), flexible('b')]).toEqual([false, true]);
  });
});

describe('rendering', () => {
  it('renders default sizes as flex-basis with min/max constraints and sizing props per pane', () => {
    renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={240} minSize={120} maxSize={360} collapsible>a</SplitPanel.Segment>,
        <SplitPanel.Segment key="b" id="b" defaultSize={300} minSize={100}>b</SplitPanel.Segment>,
      ],
    );
    // The package sizes a non-fill pane as `flex: 0 0 <size>px`. It emits no
    // min/max: grow 0 and shrink 0 make the pane rigid, so a CSS bound it can
    // never reach is redundant. The bounds are still enforced, in the resize
    // maths. Cast's old engine set both, which is what this test used to pin.
    const a = pane('a')!;
    expect(a.style.flexBasis).toBe('240px');
    expect(a.style.flexGrow).toBe('0');
    expect(a.style.flexShrink).toBe('0');
    expect(a.style.minWidth).toBe('');
    expect(a.style.maxWidth).toBe('');
  });

  it('uses height properties for a vertical split', () => {
    renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={150} minSize={80} collapsible>a</SplitPanel.Segment>,
        <SplitPanel.Segment key="b" id="b" defaultSize={300} minSize={100}>b</SplitPanel.Segment>,
      ],
      'vertical',
    );
    // 'b' is the fill pane here, and a fill pane is the one case the package
    // does bound in CSS: `flex: 1 1 0%` could otherwise shrink past minSize.
    expect(pane('a')!.style.flexBasis).toBe('150px');
    expect(pane('a')!.style.minHeight).toBe('');
    expect(pane('b')!.style.minHeight).toBe('100px');
  });

  it('hydrated persisted layout drives the rendered sizes, and a hidden pane is not rendered', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 3,
      layouts: { s: { panes: {
        a: { size: 250, visible: true, lastVisibleSize: 250 },
        b: { size: 410, visible: true, lastVisibleSize: 410 },
        c: { size: 0, visible: false, lastVisibleSize: 180 },
      } } },
    }));
    renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={200} minSize={100} collapsible>a</SplitPanel.Segment>,
        <SplitPanel.Segment key="b" id="b" defaultSize={300} minSize={100}>b</SplitPanel.Segment>,
        <SplitPanel.Segment key="c" id="c" defaultSize={150} minSize={100} collapsible>c</SplitPanel.Segment>,
      ],
    );
    // 'c' is collapsed in storage and must not render at all.
    expect(pane('c')).toBeNull();
    // 'a' is a non-fill pane, so its persisted 250 shows as the basis — this is
    // what proves hydration reached the DOM. 'b' is the fill pane and takes the
    // remainder via `flex: 1 1 0%`, so it carries no basis of its own.
    expect(pane('a')!.style.flexBasis).toBe('250px');
    expect(pane('b')!.style.flexGrow).toBe('1');
    expect(pane('b')!.style.flexBasis).toBe('0%');
  });

  it('a version-2 persisted layout is ignored and defaults render', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 2,
      layouts: { s: { panes: {
        a: { size: 0, visible: false, lastVisibleSize: 250 },
        b: { size: 410, visible: true, lastVisibleSize: 410 },
      } } },
    }));
    renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={200} minSize={100} collapsible>a</SplitPanel.Segment>,
        <SplitPanel.Segment key="b" id="b" defaultSize={300} minSize={100}>b</SplitPanel.Segment>,
      ],
    );
    // Defaults, not the discarded v2 sizes: 'a' falls back to its 200 default
    // rather than the stored 0/hidden, and 'b' fills.
    expect(pane('a')!.style.flexBasis).toBe('200px');
    expect(pane('b')!.style.flexGrow).toBe('1');
  });

  it('mounting alone (jsdom reports a 0px container) does not write to storage', () => {
    renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={200} minSize={100} collapsible>a</SplitPanel.Segment>,
        <SplitPanel.Segment key="b" id="b" defaultSize={300} minSize={100}>b</SplitPanel.Segment>,
      ],
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('validation', () => {
  it('throws when fewer than two Segment children are given', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderSplit(<SplitPanel.Segment id="a" defaultSize={200} minSize={100}>a</SplitPanel.Segment>))
      .toThrow('PanelRoute.Split requires at least two PanelRoute.Panel children.');
  });

  it('non-Segment children do not count toward the minimum', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={200} minSize={100}>a</SplitPanel.Segment>,
        <div>not a segment</div>
      ],
    )).toThrow('requires at least two');
  });

  it('usePanelRoute throws outside SplitPanel', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Probe() {
      usePanelRoute();
      return null;
    }
    expect(() => render(<Probe />)).toThrow('PanelRoute components must be used within PanelRoute.Root.');
  });

  it('PINNED SHARP EDGE: Segments wrapped in a Fragment are not collected (Children.toArray does not flatten Fragments)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(
      <SplitPanel>
        <SplitPanel.Panel splitId="s" orientation="horizontal">
          <>
            <SplitPanel.Segment id="a" defaultSize={200} minSize={100}>a</SplitPanel.Segment>
            <SplitPanel.Segment id="b" defaultSize={200} minSize={100}>b</SplitPanel.Segment>
          </>
        </SplitPanel.Panel>
      </SplitPanel>,
    )).toThrow('requires at least two');
  });
});

describe('context hook', () => {
  it('exposes togglePanel and isPanelVisible; toggling a registered pane hides it and persists', async () => {
    let ctx: ReturnType<typeof usePanelRoute> | null = null;
    function Probe() {
      ctx = usePanelRoute();
      return null;
    }
    const { rerender } = render(
      <SplitPanel>
        <Probe />
        <SplitPanel.Panel splitId="s" orientation="horizontal">
          {[
            <SplitPanel.Segment key="a" id="a" defaultSize={200} minSize={100} collapsible>a</SplitPanel.Segment>,
            <SplitPanel.Segment key="b" id="b" defaultSize={300} minSize={100}>b</SplitPanel.Segment>,
          ]}
        </SplitPanel.Panel>
      </SplitPanel>,
    );
    const { act } = await import('@testing-library/react');
    expect(ctx!.meta.isPanelVisible('s', 'a')).toBe(true);
    act(() => ctx!.actions.togglePanel('s', 'a'));
    rerender(
      <SplitPanel>
        <Probe />
        <SplitPanel.Panel splitId="s" orientation="horizontal">
          {[
            <SplitPanel.Segment key="a" id="a" defaultSize={200} minSize={100} collapsible>a</SplitPanel.Segment>,
            <SplitPanel.Segment key="b" id="b" defaultSize={300} minSize={100}>b</SplitPanel.Segment>,
          ]}
        </SplitPanel.Panel>
      </SplitPanel>,
    );
    expect(pane('a')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).layouts.s.panes.a)
      .toEqual({ size: 0, visible: false, lastVisibleSize: 200 });
  });
});
