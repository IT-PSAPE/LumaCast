import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ItemEditorSlideList } from '../../../../../app/renderer/screens/item-editor/item-editor-slide-list';

const mocks = vi.hoisted(() => ({
  screen: { value: null as unknown },
  rootProps: null as null | Record<string, unknown>,
  virtualItems: [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 160 }],
  totalSize: 640,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('../../../../../app/renderer/screens/item-editor/screen-context', () => ({
  useItemEditorScreen: () => mocks.screen.value,
}));

vi.mock('../../../../../app/renderer/features/items/slide-tag-manager', () => ({
  SlideTagManagerProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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

vi.mock('../../../../../app/renderer/screens/item-editor/item-editor-slide-list-item', () => ({
  ItemEditorSlideListItem: ({ slide, isSelected, onSelect }: {
    slide: { id: string };
    isSelected: boolean;
    onSelect: (extend: boolean) => void;
  }) => (
    <button
      type="button"
      data-selected={isSelected ? 'true' : 'false'}
      onClick={(event) => onSelect(event.shiftKey)}
    >
      {slide.id}
    </button>
  ),
}));

vi.mock('../../../../../app/renderer/screens/item-editor/slide-tile', () => ({
  SlideTile: ({ slideId }: { slideId: string }) => <div>overlay:{slideId}</div>,
}));

afterEach(() => {
  cleanup();
  mocks.rootProps = null;
  mocks.virtualItems = [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 160 }];
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

  it('does not move editor focus when Shift-click extends the slide selection', () => {
    const setCurrentSlideIndex = vi.fn();
    mocks.virtualItems = [
      { index: 0, key: 'row-0', start: 0 },
      { index: 1, key: 'row-1', start: 160 },
      { index: 2, key: 'row-2', start: 320 },
    ];
    mocks.screen.value = {
      state: {
        slides: Array.from({ length: 3 }, (_, index) => ({ id: `slide-${index}` })),
        currentSlideIndex: 0,
        currentItemRef: { type: 'presentation', id: 'item-1' },
      },
      actions: {
        reorderSlide: vi.fn(),
        setCurrentSlideIndex,
      },
    };

    const scrollElement = document.createElement('div');
    render(<ItemEditorSlideList getScrollElement={() => scrollElement} />);
    fireEvent.click(screen.getByRole('button', { name: 'slide-2' }), { shiftKey: true });

    expect(setCurrentSlideIndex).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'slide-0' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'slide-1' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'slide-2' }).getAttribute('data-selected')).toBe('true');
  });
});
