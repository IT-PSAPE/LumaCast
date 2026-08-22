import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemEditorSlideList } from './item-editor-slide-list';

const mocks = vi.hoisted(() => ({
  screen: { value: null as unknown },
  rootProps: null as null | Record<string, unknown>,
  virtualItems: [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 160 }],
  totalSize: 640,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('./screen-context', () => ({
  useItemEditorScreen: () => mocks.screen.value,
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

vi.mock('./item-editor-slide-list-item', () => ({
  ItemEditorSlideListItem: ({ slide }: { slide: { id: string } }) => <div>{slide.id}</div>,
}));

vi.mock('./slide-tile', () => ({
  SlideTile: ({ slideId }: { slideId: string }) => <div>overlay:{slideId}</div>,
}));

afterEach(() => {
  cleanup();
  mocks.rootProps = null;
  mocks.measureElement.mockReset();
  mocks.scrollToIndex.mockReset();
});

describe('ItemEditorSlideList', () => {
  it('renders a bounded subset and resolves the active slide through the virtualizer', () => {
    mocks.screen.value = {
      state: {
        slides: Array.from({ length: 5 }, (_, index) => ({ id: `slide-${index}` })),
        currentSlideIndex: 4,
        currentItemRef: { type: 'presentation', id: 'item-1' },
      },
      actions: {
        reorderSlide: vi.fn(),
      },
    };

    const scrollElement = document.createElement('div');
    render(<ItemEditorSlideList getScrollElement={() => scrollElement} />);

    expect(screen.getByText('slide-0')).not.toBeNull();
    expect(screen.getByText('slide-1')).not.toBeNull();
    expect(screen.queryByText('slide-2')).toBeNull();
    expect(mocks.scrollToIndex).toHaveBeenCalledWith(4, { align: 'auto' });

    const virtualizedKeyboard = (mocks.rootProps as { virtualizedKeyboard: { scrollToIndex: (index: number) => void } }).virtualizedKeyboard;
    virtualizedKeyboard.scrollToIndex(17);
    expect(mocks.scrollToIndex).toHaveBeenLastCalledWith(17, { align: 'auto' });
  });
});
