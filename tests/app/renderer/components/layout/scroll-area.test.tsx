import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
  useScrollAreaActiveItem,
} from '../../../../../app/renderer/components/layout/scroll-area';

// The scroll area is backed by Base UI's ScrollArea; these tests pin the parts of
// the surface lumacast depends on: the compound API, the viewport element handed to
// the virtualized lists (stable ref + pass-through scroll events), the overflow-edge
// thresholds, and the active-item scroll-into-view hook Base UI does not ship.

afterEach(cleanup);

function sizeViewport(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  Object.defineProperty(element, 'clientHeight', { value: metrics.clientHeight, configurable: true });
  Object.defineProperty(element, 'scrollHeight', { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: 200, configurable: true });
  Object.defineProperty(element, 'scrollWidth', { value: 200, configurable: true });
  Object.defineProperty(element, 'scrollTop', { value: metrics.scrollTop, configurable: true });
}

function stubRect(element: HTMLElement, rect: { top: number; bottom: number }) {
  element.getBoundingClientRect = () => ({
    top: rect.top,
    bottom: rect.bottom,
    left: 0,
    right: 200,
    width: 200,
    height: rect.bottom - rect.top,
    x: 0,
    y: rect.top,
    toJSON: () => ({}),
  }) as DOMRect;
}

describe('ScrollArea public API', () => {
  it('exposes the compound parts and the named exports', () => {
    expect(ScrollArea.Root).toBe(ScrollAreaRoot);
    expect(ScrollArea.Viewport).toBe(ScrollAreaViewport);
    expect(ScrollArea.Scrollbar).toBe(ScrollAreaScrollbar);
    expect(ScrollArea.Thumb).toBe(ScrollAreaThumb);
    expect(ScrollArea.Content).toBe(ScrollAreaContent);
    expect(ScrollArea.Corner).toBe(ScrollAreaCorner);
    expect(typeof useScrollAreaActiveItem).toBe('function');
  });

  it('renders root, viewport, content and a kept-mounted scrollbar/thumb pair', () => {
    render(
      <ScrollArea.Root data-testid="root" className="custom-root">
        <ScrollArea.Viewport data-testid="viewport" className="custom-viewport">
          <ScrollArea.Content data-testid="content">body</ScrollArea.Content>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar data-testid="scrollbar" keepMounted>
          <ScrollArea.Thumb data-testid="thumb" />
        </ScrollArea.Scrollbar>
        <ScrollArea.Corner data-testid="corner" />
      </ScrollArea.Root>,
    );

    const root = document.querySelector('[data-testid="root"]') as HTMLElement;
    const viewport = document.querySelector('[data-testid="viewport"]') as HTMLElement;
    const scrollbar = document.querySelector('[data-testid="scrollbar"]') as HTMLElement;
    const thumb = document.querySelector('[data-testid="thumb"]') as HTMLElement;

    expect(root.className).toContain('custom-root');
    expect(root.style.position).toBe('relative');
    expect(viewport.className).toContain('custom-viewport');
    // The viewport is the scroll container the virtualizers measure.
    expect(viewport.style.overflow).toBe('scroll');
    expect(viewport.getAttribute('role')).toBe('presentation');
    expect(document.querySelector('[data-testid="content"]')?.textContent).toBe('body');
    expect(scrollbar.getAttribute('data-orientation')).toBe('vertical');
    expect(scrollbar.className).toContain('data-[hovering]:opacity-100');
    expect(scrollbar.className).toContain('data-[scrolling]:opacity-100');
    expect(thumb.getAttribute('data-orientation')).toBe('vertical');
    expect(thumb.className).toContain('bg-(--text-color-tertiary)/50');
    expect(thumb.className).toContain('hover:bg-(--text-color-tertiary)/80');
    // No overflow has been measured, so the corner stays unmounted.
    expect(document.querySelector('[data-testid="corner"]')).toBeNull();
  });

  it('lets the caller override the viewport role and keeps a horizontal scrollbar horizontal', () => {
    render(
      <ScrollArea.Root>
        <ScrollArea.Viewport role="list" aria-label="Playlists" />
        <ScrollArea.Scrollbar orientation="horizontal" data-testid="scrollbar-x" keepMounted>
          <ScrollArea.Thumb data-testid="thumb-x" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>,
    );

    expect(document.querySelector('[aria-label="Playlists"]')?.getAttribute('role')).toBe('list');
    expect(document.querySelector('[data-testid="scrollbar-x"]')?.getAttribute('data-orientation')).toBe('horizontal');
    expect(document.querySelector('[data-testid="thumb-x"]')?.getAttribute('data-orientation')).toBe('horizontal');
  });
});

describe('ScrollArea.Viewport element contract', () => {
  it('forwards the viewport element through a ref object and keeps it attached across re-renders', () => {
    const attachments: Array<HTMLElement | null> = [];
    const collectRef = (node: HTMLDivElement | null) => {
      attachments.push(node);
    };

    function Harness() {
      const [label, setLabel] = useState('a');
      return (
        <ScrollArea.Root>
          <ScrollArea.Viewport ref={collectRef} data-testid="viewport">
            <button type="button" onClick={() => setLabel('b')}>{label}</button>
          </ScrollArea.Viewport>
        </ScrollArea.Root>
      );
    }

    render(<Harness />);
    const viewport = document.querySelector('[data-testid="viewport"]');
    expect(attachments).toEqual([viewport]);

    fireEvent.click(document.querySelector('button') as HTMLElement);

    // A re-render must not detach/reattach the scroll element: VirtualizedList polls it
    // through `getScrollElement()` and re-measures whenever the element identity changes.
    expect(attachments).toEqual([viewport]);
  });

  it('runs caller scroll and interaction handlers on the viewport', () => {
    const ref = createRef<HTMLDivElement>();
    const onScroll = vi.fn();
    const onWheel = vi.fn();
    const onKeyDown = vi.fn();

    render(
      <ScrollArea.Root>
        <ScrollArea.Viewport ref={ref} onScroll={onScroll} onWheel={onWheel} onKeyDown={onKeyDown} />
      </ScrollArea.Root>,
    );

    const viewport = ref.current as HTMLDivElement;
    fireEvent.scroll(viewport);
    fireEvent.wheel(viewport);
    fireEvent.keyDown(viewport, { key: 'ArrowDown' });

    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(onWheel).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe('ScrollArea overflow edges', () => {
  it('flags the vertical start edge once the scroll offset passes the threshold', () => {
    function Harness({ threshold }: { threshold: number }) {
      return (
        <ScrollArea.Root data-testid="root" overflowEdgeThreshold={threshold}>
          <ScrollArea.Viewport data-testid="viewport" />
        </ScrollArea.Root>
      );
    }

    const { rerender } = render(<Harness threshold={0} />);
    const viewport = document.querySelector('[data-testid="viewport"]') as HTMLElement;
    const root = document.querySelector('[data-testid="root"]') as HTMLElement;
    sizeViewport(viewport, { clientHeight: 100, scrollHeight: 500, scrollTop: 50 });

    fireEvent.scroll(viewport);
    expect(root.hasAttribute('data-has-overflow-y')).toBe(true);
    expect(root.hasAttribute('data-overflow-y-start')).toBe(true);
    expect(root.hasAttribute('data-overflow-y-end')).toBe(true);

    // 50px scrolled is below an 80px threshold, so the start edge reads as "at the top".
    rerender(<Harness threshold={80} />);
    fireEvent.scroll(viewport);
    expect(root.hasAttribute('data-overflow-y-start')).toBe(false);
    expect(root.hasAttribute('data-overflow-y-end')).toBe(true);
  });
});

describe('useScrollAreaActiveItem', () => {
  function ActiveItemHarness({
    isActive,
    scrollPadding,
  }: {
    isActive: boolean;
    scrollPadding?: number | `${number}%`;
  }) {
    return (
      <ScrollArea.Root scrollPadding={scrollPadding}>
        <ScrollArea.Viewport data-testid="viewport">
          <Item isActive={isActive} />
        </ScrollArea.Viewport>
      </ScrollArea.Root>
    );
  }

  function Item({ isActive }: { isActive: boolean }) {
    const ref = useScrollAreaActiveItem<HTMLDivElement>(isActive);
    return <div ref={ref} data-testid="item">item</div>;
  }

  function prepare(scrollPadding?: number | `${number}%`) {
    const view = render(<ActiveItemHarness isActive={false} scrollPadding={scrollPadding} />);
    const viewport = document.querySelector('[data-testid="viewport"]') as HTMLElement;
    const item = document.querySelector('[data-testid="item"]') as HTMLElement;
    const scrollBy = vi.fn();
    viewport.scrollBy = scrollBy;
    stubRect(viewport, { top: 0, bottom: 100 });
    return { ...view, viewport, item, scrollBy };
  }

  it('scrolls an item below the fold into view, offset by the numeric scroll padding', () => {
    const { rerender, item, scrollBy } = prepare(10);
    stubRect(item, { top: 150, bottom: 180 });

    rerender(<ActiveItemHarness isActive scrollPadding={10} />);

    expect(scrollBy).toHaveBeenCalledWith({ top: 90 });
  });

  it('resolves percentage scroll padding against the viewport height', () => {
    const { rerender, item, scrollBy } = prepare('20%');
    stubRect(item, { top: -30, bottom: 0 });

    rerender(<ActiveItemHarness isActive scrollPadding="20%" />);

    expect(scrollBy).toHaveBeenCalledWith({ top: -50 });
  });

  it('leaves an already-visible item alone and ignores inactive items', () => {
    const { rerender, item, scrollBy } = prepare();
    stubRect(item, { top: 20, bottom: 40 });

    rerender(<ActiveItemHarness isActive={false} />);
    expect(scrollBy).not.toHaveBeenCalled();

    rerender(<ActiveItemHarness isActive />);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('throws when used outside a ScrollArea.Root', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Item isActive />)).toThrow(/ScrollArea.Root/);
    consoleError.mockRestore();
  });
});
