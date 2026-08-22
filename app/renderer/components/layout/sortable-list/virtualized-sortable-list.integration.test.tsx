import { useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableList } from './sortable-list';
import { useSortableOrder, type SortableOrderCommit } from './use-sortable-order';
import { VirtualizedList } from '../virtualized-list';

const mocks = vi.hoisted(() => ({
  dndProps: null as null | {
    onDragStart: (event: DragStartEvent) => void;
    onDragEnd: (event: DragEndEvent) => void;
    onDragCancel: () => void;
  },
  measureElement: vi.fn(),
  useSensor: vi.fn((_sensor, options) => ({ options })),
  useSensors: vi.fn((...sensors) => sensors),
}));

vi.mock('@dnd-kit/core', () => ({
  closestCenter: vi.fn(),
  DndContext: ({
    children,
    onDragStart,
    onDragEnd,
    onDragCancel,
  }: {
    children: React.ReactNode;
    onDragStart: (event: DragStartEvent) => void;
    onDragEnd: (event: DragEndEvent) => void;
    onDragCancel: () => void;
  }) => {
    mocks.dndProps = { onDragStart, onDragEnd, onDragCancel };
    return <div data-testid="dnd-context">{children}</div>;
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div data-testid="drag-overlay">{children}</div>,
  KeyboardSensor: class KeyboardSensor {},
  PointerSensor: class PointerSensor {},
  TouchSensor: class TouchSensor {},
  MeasuringStrategy: { Always: 0, BeforeDragging: 1, WhileDragging: 2 },
  useSensor: mocks.useSensor,
  useSensors: mocks.useSensors,
}));

vi.mock('@dnd-kit/sortable', () => ({
  rectSortingStrategy: vi.fn(),
  SortableContext: ({ children }: { children: React.ReactNode }) => <div data-testid="sortable-context">{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: ({ id }: { id: string }) => ({
    attributes: { 'data-sortable-id': id },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
  verticalListSortingStrategy: vi.fn(),
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
          const itemSize = measurementsCache[0]?.size ?? 0;
          if (itemSize <= 0) return [];
          const startIndex = Math.max(0, Math.floor(scrollElement.scrollTop / itemSize));
          const visibleCount = Math.max(1, Math.ceil(viewportHeight / itemSize));
          const overscan = options.overscan ?? 0;
          const from = Math.max(0, startIndex - overscan);
          const to = Math.min(options.count - 1, startIndex + visibleCount - 1 + overscan);
          return measurementsCache.slice(from, to + 1);
        },
        scrollToIndex: () => undefined,
      };
    }),
  };
});

const originalScrollTo = HTMLElement.prototype.scrollTo;
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

interface Row {
  id: string;
}

function Harness({ commit }: { commit: (change: SortableOrderCommit) => void }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const persistedRows = Array.from({ length: 20 }, (_, index) => ({ id: `row-${index}` }));
  const { items, dnd } = useSortableOrder({
    items: persistedRows,
    getId: (row: Row) => row.id,
    commit,
  });
  const activeIndex = dnd.activeId ? items.findIndex((row) => row.id === dnd.activeId) : -1;
  const scrollToIndex = (index: number) => {
    viewportRef.current?.scrollTo({ top: index * 40 });
  };

  return (
    <div ref={viewportRef} data-viewport="true" style={{ height: 120, overflow: 'auto' }}>
      <SortableList.Root
        {...dnd}
        activeId={dnd.activeId}
        virtualizedKeyboard={{ onMoveToIndex: dnd.onKeyboardMoveToIndex, scrollToIndex }}
        dragOverlay={activeIndex === -1 ? null : <div>Overlay {dnd.activeId}</div>}
      >
        <VirtualizedList
          getScrollElement={() => viewportRef.current}
          estimateSize={40}
          overscan={0}
          retainedIndexes={activeIndex === -1 ? [] : [activeIndex]}
        >
          {items.map((row) => (
            <SortableList.Item key={row.id} id={row.id}>
              <div>{row.id}</div>
            </SortableList.Item>
          ))}
        </VirtualizedList>
      </SortableList.Root>
    </div>
  );
}

describe('virtualized sortable integration', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn(function scrollTo(this: HTMLElement, options?: ScrollToOptions | number) {
      if (typeof options === 'number' || options == null) return;
      if (typeof options.top === 'number') this.scrollTop = options.top;
      this.dispatchEvent(new Event('scroll'));
    }) as unknown as typeof HTMLElement.prototype.scrollTo;
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
    mocks.dndProps = null;
    mocks.measureElement.mockReset();
    mocks.useSensor.mockClear();
    mocks.useSensors.mockClear();
  });

  it('keeps the dragged source mounted during scroll and commits when an offscreen drop id is supplied', async () => {
    const commit = vi.fn();

    render(<Harness commit={commit} />);

    await waitFor(() => {
      expect(screen.getByText('row-0')).not.toBeNull();
    });
    expect(screen.queryByText('row-8')).toBeNull();

    act(() => {
      mocks.dndProps?.onDragStart({ active: { id: 'row-1' } } as DragStartEvent);
    });

    expect(screen.getByTestId('drag-overlay').textContent).toContain('Overlay row-1');

    const viewport = screen.getByText('row-0').closest('[data-viewport="true"]');
    if (!(viewport instanceof HTMLDivElement)) throw new Error('viewport missing');

    act(() => {
      viewport.scrollTop = 320;
      fireEvent.scroll(viewport);
    });

    await waitFor(() => {
      expect(screen.getByText('row-8')).not.toBeNull();
    });

    expect(screen.queryByText('row-0')).toBeNull();
    expect(screen.getByText('row-1').closest('[data-retained="true"]')).not.toBeNull();

    await act(async () => {
      mocks.dndProps?.onDragEnd({
        active: { id: 'row-1' },
        over: { id: 'row-12' },
      } as DragEndEvent);
      await Promise.resolve();
    });

    expect(commit).toHaveBeenCalledWith({
      id: 'row-1',
      fromIndex: 1,
      toIndex: 12,
      orderedIds: [
        'row-0',
        'row-2',
        'row-3',
        'row-4',
        'row-5',
        'row-6',
        'row-7',
        'row-8',
        'row-9',
        'row-10',
        'row-11',
        'row-12',
        'row-1',
        'row-13',
        'row-14',
        'row-15',
        'row-16',
        'row-17',
        'row-18',
        'row-19',
      ],
    });
  });

  it('reorders by keyboard beyond the mounted viewport and drops at the logical offscreen index', async () => {
    const commit = vi.fn();

    render(<Harness commit={commit} />);

    await waitFor(() => {
      expect(screen.getByText('row-0')).not.toBeNull();
    });
    const viewport = screen.getByText('row-0').closest('[data-viewport="true"]');
    if (!(viewport instanceof HTMLDivElement)) throw new Error('viewport missing');

    act(() => {
      mocks.dndProps?.onDragStart({ active: { id: 'row-1' } } as DragStartEvent);
    });
    await waitFor(() => {
      expect(screen.getByTestId('drag-overlay').textContent).toContain('Overlay row-1');
    });

    const getKeyboardCoordinateGetter = () => {
      const keyboardCall = mocks.useSensor.mock.calls
        .filter(([, options]) => options && typeof options === 'object' && 'coordinateGetter' in options)
        .at(-1);
      if (!keyboardCall) throw new Error('keyboard sensor missing');
      return (keyboardCall[1] as {
        coordinateGetter: (event: KeyboardEvent, args: { currentCoordinates: { x: number; y: number }; context: { over: null } }) => unknown;
      }).coordinateGetter;
    };

    for (let step = 0; step < 4; step += 1) {
      await act(async () => {
        getKeyboardCoordinateGetter()(
          { code: 'ArrowDown' } as KeyboardEvent,
          { currentCoordinates: { x: 0, y: 0 }, context: { over: null } },
        );
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(viewport.scrollTop).toBe((step + 2) * 40);
      });
    }

    await waitFor(() => {
      expect(screen.getByText('row-5')).not.toBeNull();
    });

    expect(viewport.scrollTop).toBe(200);

    await act(async () => {
      mocks.dndProps?.onDragEnd({
        active: { id: 'row-1' },
        over: null,
      } as DragEndEvent);
      await Promise.resolve();
    });

    expect(commit).toHaveBeenCalledWith({
      id: 'row-1',
      fromIndex: 1,
      toIndex: 5,
      orderedIds: [
        'row-0',
        'row-2',
        'row-3',
        'row-4',
        'row-5',
        'row-1',
        'row-6',
        'row-7',
        'row-8',
        'row-9',
        'row-10',
        'row-11',
        'row-12',
        'row-13',
        'row-14',
        'row-15',
        'row-16',
        'row-17',
        'row-18',
        'row-19',
      ],
    });
  });
});
