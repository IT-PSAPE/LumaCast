import { useRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualizedList } from './virtualized-list';
import { RenameField } from '../form/rename-field';

const mocks = vi.hoisted(() => ({
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', async () => {
  const React = await import('react');

  return {
    useVirtualizer: vi.fn((options: {
      count: number;
      estimateSize: (index: number) => number;
      overscan?: number;
      getItemKey: (index: number) => string | number;
      getScrollElement: () => HTMLElement | null;
    }) => {
      const [, forceRender] = React.useReducer((value: number) => value + 1, 0);
      const measurementsCache = React.useMemo(() => {
        let start = 0;
        return Array.from({ length: options.count }, (_, index) => {
          const size = options.estimateSize(index);
          const item = { index, key: options.getItemKey(index), start, end: start + size, size };
          start += size;
          return item;
        });
      }, [options]);

      React.useEffect(() => {
        const scrollElement = options.getScrollElement();
        if (!scrollElement) return;
        const onScroll = () => forceRender();
        scrollElement.addEventListener('scroll', onScroll);
        return () => scrollElement.removeEventListener('scroll', onScroll);
      });

      return {
        measurementsCache,
        measureElement: mocks.measureElement,
        getTotalSize: () => measurementsCache.at(-1)?.end ?? 0,
        getVirtualItems: () => {
          const scrollElement = options.getScrollElement();
          if (!scrollElement) return [];
          const viewportHeight = scrollElement.getBoundingClientRect().height;
          const viewportTop = scrollElement.scrollTop;
          const viewportBottom = viewportTop + viewportHeight;
          const startIndex = Math.max(0, measurementsCache.findIndex((item) => item.end > viewportTop));
          let endIndex = measurementsCache.findIndex((item) => item.start >= viewportBottom);
          if (endIndex === -1) endIndex = measurementsCache.length;
          const overscan = options.overscan ?? 0;
          const from = Math.max(0, startIndex - overscan);
          const to = Math.min(options.count - 1, endIndex - 1 + overscan);
          return measurementsCache.slice(from, to + 1);
        },
        scrollToIndex: (index: number, { align }: { align?: string } = {}) => {
          mocks.scrollToIndex(index, { align });
          const scrollElement = options.getScrollElement();
          if (!scrollElement) return;
          const top = measurementsCache[index]?.start ?? 0;
          scrollElement.scrollTop = top;
          scrollElement.scrollTo({ top });
          forceRender();
        },
      };
    }),
  };
});

const originalScrollTo = HTMLElement.prototype.scrollTo;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

describe('VirtualizedList live scroll root', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn() as unknown as typeof HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const height = this instanceof HTMLElement && this.dataset.viewport === 'true' ? 120 : 40;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 240,
        bottom: height,
        width: 240,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    };
  });

  afterEach(() => {
    cleanup();
    HTMLElement.prototype.scrollTo = originalScrollTo;
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    mocks.measureElement.mockReset();
    mocks.scrollToIndex.mockReset();
  });

  it('resolves the viewport ref after mount before handling the active index', async () => {
    function Harness() {
      const viewportRef = useRef<HTMLDivElement | null>(null);

      return (
        <div ref={viewportRef} data-viewport="true" style={{ height: 120, overflow: 'auto' }}>
          <VirtualizedList getScrollElement={() => viewportRef.current} estimateSize={40} activeIndex={8} overscan={0}>
            {Array.from({ length: 20 }, (_, index) => <div key={index}>Row {index}</div>)}
          </VirtualizedList>
        </div>
      );
    }

    render(<Harness />);

    await waitFor(() => {
      expect(mocks.scrollToIndex).toHaveBeenCalledWith(8, { align: 'auto' });
    });
    expect(screen.getByText('Row 8')).not.toBeNull();
    expect(screen.queryByText('Row 0')).toBeNull();
  });

  it('retains an explicitly pinned offscreen row while the viewport scrolls away from it', async () => {
    function Harness() {
      const viewportRef = useRef<HTMLDivElement | null>(null);

      return (
        <div ref={viewportRef} data-viewport="true" style={{ height: 120, overflow: 'auto' }}>
          <VirtualizedList
            getScrollElement={() => viewportRef.current}
            estimateSize={40}
            overscan={0}
            retainedIndexes={[1]}
          >
            {Array.from({ length: 20 }, (_, index) => <div key={index}>Row {index}</div>)}
          </VirtualizedList>
        </div>
      );
    }

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByText('Row 0')).not.toBeNull();
    });
    expect(screen.getByText('Row 1')).not.toBeNull();
    expect(screen.queryByText('Row 8')).toBeNull();

    const viewport = screen.getByText('Row 0').closest('[data-viewport="true"]');
    if (!(viewport instanceof HTMLDivElement)) throw new Error('viewport missing');

    viewport.scrollTop = 320;
    fireEvent.scroll(viewport);

    await waitFor(() => {
      expect(screen.getByText('Row 8')).not.toBeNull();
    });

    expect(screen.queryByText('Row 0')).toBeNull();
    const retainedRow = screen.getByText('Row 1').closest('[data-retained="true"]');
    expect(retainedRow).not.toBeNull();
  });

  it('retains a focused rename field offscreen so its draft survives scrolling past overscan', async () => {
    const onValueChange = vi.fn();

    function Harness() {
      const viewportRef = useRef<HTMLDivElement | null>(null);

      return (
        <div ref={viewportRef} data-viewport="true" style={{ height: 120, overflow: 'auto' }}>
          <VirtualizedList getScrollElement={() => viewportRef.current} estimateSize={40} overscan={0}>
            {Array.from({ length: 20 }, (_, index) => (
              <div key={index}>
                {index === 1 ? (
                  <RenameField value="Row 1" onValueChange={onValueChange} />
                ) : (
                  <div>Row {index}</div>
                )}
              </div>
            ))}
          </VirtualizedList>
        </div>
      );
    }

    render(<Harness />);

    const renameInput = screen.getByDisplayValue('Row 1');
    fireEvent.doubleClick(renameInput);
    fireEvent.change(renameInput, { target: { value: 'Row 1 draft' } });

    const viewport = renameInput.closest('[data-viewport="true"]');
    if (!(viewport instanceof HTMLDivElement)) throw new Error('viewport missing');

    viewport.scrollTop = 320;
    fireEvent.scroll(viewport);

    await waitFor(() => {
      expect(screen.getByText('Row 8')).not.toBeNull();
    });

    const retainedRow = screen.getByDisplayValue('Row 1 draft').closest('[data-retained="true"]');
    expect(retainedRow).not.toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('exposes virtualizer-backed scrollToIndex for high-index variable-height targets', async () => {
    function Harness() {
      const viewportRef = useRef<HTMLDivElement | null>(null);
      const scrollToIndexRef = useRef<((index: number) => void) | null>(null);

      return (
        <div ref={viewportRef} data-viewport="true" style={{ height: 120, overflow: 'auto' }}>
          <button type="button" onClick={() => scrollToIndexRef.current?.(6)}>Jump</button>
          <VirtualizedList
            getScrollElement={() => viewportRef.current}
            estimateSize={(index) => [84, 96, 108, 120, 132, 144, 156][index] ?? 156}
            overscan={0}
            scrollToIndexRef={scrollToIndexRef}
          >
            {Array.from({ length: 7 }, (_, index) => <div key={index}>Row {index}</div>)}
          </VirtualizedList>
        </div>
      );
    }

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByText('Row 0')).not.toBeNull();
    });
    expect(screen.queryByText('Row 6')).toBeNull();

    fireEvent.click(screen.getByText('Jump'));

    await waitFor(() => {
      expect(mocks.scrollToIndex).toHaveBeenCalledWith(6, { align: 'auto' });
      expect(screen.getByText('Row 6')).not.toBeNull();
    });
    expect(screen.queryByText('Row 0')).toBeNull();
  });
});
