import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SingleSlideGrid } from './single-slide-grid';

const mocks = vi.hoisted(() => ({
  navigation: { value: null as unknown },
  slides: { value: null as unknown },
  scenes: { value: null as unknown },
  deckBrowser: { value: null as unknown },
  rootProps: null as null | Record<string, unknown>,
  virtualItems: [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 166 }],
  totalSize: 996,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('../../contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('../../contexts/slide-context', () => ({
  useSlides: () => mocks.slides.value,
}));

vi.mock('../../contexts/canvas/canvas-context', () => ({
  useThumbnailScene: () => (mocks.scenes.value as { getThumbnailScene: () => unknown }).getThumbnailScene,
}));

vi.mock('./deck-browser-context', () => ({
  useDeckBrowser: () => mocks.deckBrowser.value,
}));

vi.mock('./use-slide-reorder', () => ({
  useSlideReorder: (items: unknown[]) => ({
    items,
    dnd: {
      ids: [],
      disabled: false,
      onKeyboardMoveToIndex: vi.fn(),
      onDragStart: vi.fn(),
      onDragEnd: vi.fn(),
      onDragCancel: vi.fn(),
    },
  }),
}));

vi.mock('@renderer/components/layout/sortable-list', () => ({
  SortableList: {
    Root: ({ children, ...props }: { children: React.ReactNode }) => {
      mocks.rootProps = props;
      return <div data-testid="sortable-root">{children}</div>;
    },
  },
  VIRTUALIZED_SORTABLE_MEASURING: { droppable: { strategy: 0 } },
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(() => ({
    getVirtualItems: () => mocks.virtualItems,
    getTotalSize: () => mocks.totalSize,
    measureElement: mocks.measureElement,
    scrollToIndex: mocks.scrollToIndex,
  })),
}));

vi.mock('@renderer/components/layout/scroll-area', async () => {
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

vi.mock('./sortable-slide-grid-tile', () => ({
  SortableSlideGridTile: ({ slideId }: { slideId: string }) => <div>{slideId}</div>,
}));

vi.mock('./slide-grid-tile', () => ({
  SlideGridTile: ({ slideId }: { slideId: string }) => <div>overlay:{slideId}</div>,
}));

afterEach(() => {
  cleanup();
  mocks.rootProps = null;
  mocks.measureElement.mockReset();
  mocks.scrollToIndex.mockReset();
});

describe('SingleSlideGrid', () => {
  it('renders a bounded subset and uses the row virtualizer for high-index keyboard scroll targets', () => {
    mocks.navigation.value = {
      currentItemRef: { type: 'presentation', id: 'item-1' },
      currentOutputItemRef: { type: 'presentation', id: 'item-1' },
      isDetachedDeckBrowser: false,
    };
    mocks.slides.value = {
      slides: Array.from({ length: 18 }, (_, index) => ({ id: `slide-${index}` })),
      currentSlideIndex: 7,
      liveSlideIndex: -1,
      slideElementsById: new Map(),
      activateSlide: vi.fn(),
      setCurrentSlideIndex: vi.fn(),
      reorderSlide: vi.fn(),
    };
    mocks.scenes.value = { getThumbnailScene: vi.fn(() => ({ width: 1920, height: 1080 })) };
    mocks.deckBrowser.value = { gridItemSize: 3 };

    render(<SingleSlideGrid />);

    expect(screen.getByText('slide-0')).not.toBeNull();
    expect(screen.getByText('slide-5')).not.toBeNull();
    expect(screen.queryByText('slide-6')).toBeNull();
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(2, { align: 'auto' });

    const virtualizedKeyboard = (mocks.rootProps as { virtualizedKeyboard: { scrollToIndex: (index: number) => void } }).virtualizedKeyboard;
    virtualizedKeyboard.scrollToIndex(17);
    expect(mocks.scrollToIndex).toHaveBeenLastCalledWith(5, { align: 'auto' });
  });
});
