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
    const a = pane('a')!;
    expect(a.style.flexBasis).toBe('240px');
    expect(a.style.minWidth).toBe('120px');
    expect(a.style.maxWidth).toBe('360px');
    expect(a.style.flexShrink).toBe('0');
    expect(pane('b')!.style.maxWidth).toBe('');
  });

  it('uses height properties for a vertical split', () => {
    renderSplit(
      [
        <SplitPanel.Segment key="a" id="a" defaultSize={150} minSize={80} collapsible>a</SplitPanel.Segment>,
        <SplitPanel.Segment key="b" id="b" defaultSize={300} minSize={100}>b</SplitPanel.Segment>,
      ],
      'vertical',
    );
    expect(pane('a')!.style.flexBasis).toBe('150px');
    expect(pane('a')!.style.minHeight).toBe('80px');
  });

  it('hydrated persisted layout drives the rendered sizes, and a hidden pane is not rendered', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 3,
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
    expect(pane('a')).toBeNull();
    expect(pane('b')!.style.flexBasis).toBe('410px');
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
    expect(pane('a')!.style.flexBasis).toBe('200px');
    expect(pane('b')!.style.flexBasis).toBe('300px');
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
