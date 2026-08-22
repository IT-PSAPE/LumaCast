import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SingleSlideList } from './single-slide-list';

const mocks = vi.hoisted(() => ({
  outlineView: { value: null as unknown },
  slides: { value: null as unknown },
  scenes: { value: null as unknown },
  rootProps: null as null | Record<string, unknown>,
  virtualItems: [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 56 }],
  totalSize: 560,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('./use-slide-list-view', () => ({
  useOutlineView: () => mocks.outlineView.value,
}));

vi.mock('../../contexts/slide-context', () => ({
  useSlides: () => mocks.slides.value,
}));

vi.mock('../../contexts/canvas/canvas-context', () => ({
  useThumbnailScene: () => (mocks.scenes.value as { getThumbnailScene: () => unknown }).getThumbnailScene,
}));

vi.mock('@renderer/components/layout/sortable-list', () => ({
  SortableList: {
    Root: ({ children, ...props }: { children: React.ReactNode }) => {
      mocks.rootProps = props;
      return <div data-testid="sortable-root">{children}</div>;
    },
  },
  VIRTUALIZED_SORTABLE_MEASURING: { droppable: { strategy: 0 } },
  useSortableOrder: ({ items }: { items: unknown[] }) => ({
    items,
    dnd: { ids: [], disabled: false, onDragStart: vi.fn(), onDragEnd: vi.fn(), onDragCancel: vi.fn() },
  }),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(() => ({
    getVirtualItems: () => mocks.virtualItems,
    getTotalSize: () => mocks.totalSize,
    measureElement: mocks.measureElement,
    scrollToIndex: mocks.scrollToIndex,
  })),
}));

vi.mock('../../components/layout/scroll-area', async () => {
  const React = await import('react');
  return {
    ScrollArea: {
      Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Viewport: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ children, ...props }, ref) => (
        <div ref={ref} {...props}>{children}</div>
      )),
      Scrollbar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Thumb: () => <div />,
    },
  };
});

vi.mock('./sortable-slide-outline-row', () => ({
  SortableSlideOutlineRow: ({ row }: { row: { slide: { id: string } } }) => <div>{row.slide.id}</div>,
}));

vi.mock('./slide-list-row', () => ({
  SlideOutlineRow: ({ row }: { row: { slide: { id: string } } }) => <div>overlay:{row.slide.id}</div>,
}));

afterEach(() => {
  cleanup();
  mocks.rootProps = null;
  mocks.virtualItems = [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 56 }];
  mocks.scrollToIndex.mockReset();
  mocks.measureElement.mockReset();
});

describe('SingleSlideList', () => {
  it('renders a bounded subset and scrolls the selected offscreen slide into view through the virtualizer', () => {
    mocks.outlineView.value = {
      rows: Array.from({ length: 8 }, (_, index) => ({
        slide: { id: `slide-${index}` },
        index,
      })),
      currentSlideIndex: 6,
      selectSlide: vi.fn(),
      openSlide: vi.fn(),
      updateText: vi.fn(),
    };
    mocks.slides.value = { reorderSlide: vi.fn() };
    mocks.scenes.value = { getThumbnailScene: vi.fn(() => ({ width: 1920, height: 1080 })) };

    render(<SingleSlideList />);

    expect(screen.getByText('slide-0')).not.toBeNull();
    expect(screen.getByText('slide-1')).not.toBeNull();
    expect(screen.queryByText('slide-2')).toBeNull();
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(6, { align: 'auto' });

    const virtualizedKeyboard = (mocks.rootProps as { virtualizedKeyboard: { scrollToIndex: (index: number) => void } }).virtualizedKeyboard;
    virtualizedKeyboard.scrollToIndex(17);
    expect(mocks.scrollToIndex).toHaveBeenLastCalledWith(17, { align: 'auto' });
  });
});
