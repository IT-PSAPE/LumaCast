import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SingleSlideList } from '../../../../../../apps/cast/renderer/features/items/single-slide-list';

const mocks = vi.hoisted(() => ({
  outlineView: { value: null as unknown },
  navigation: { value: null as unknown },
  slides: { value: null as unknown },
  scenes: { value: null as unknown },
  rootProps: null as null | Record<string, unknown>,
  virtualItems: [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 56 }],
  totalSize: 560,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  onKeyboardMoveToIndex: vi.fn(),
  duplicateSlide: vi.fn(),
  deleteSlide: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@lumacast/ui', async () => {
  const actual = await vi.importActual<typeof import('@lumacast/ui')>('@lumacast/ui');
  return { ...actual, useConfirm: () => mocks.confirm };
});

vi.mock('../../../../../../apps/cast/renderer/features/items/use-slide-list-view', () => ({
  useOutlineView: () => mocks.outlineView.value,
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/slide-context', () => ({
  useSlides: () => mocks.slides.value,
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/canvas/canvas-context', () => ({
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
    dnd: { ids: [], disabled: false, onKeyboardMoveToIndex: mocks.onKeyboardMoveToIndex, onDragStart: vi.fn(), onDragEnd: vi.fn(), onDragCancel: vi.fn() },
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

vi.mock('../../../../../../apps/cast/renderer/components/layout/scroll-area', async () => {
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

vi.mock('../../../../../../apps/cast/renderer/features/items/sortable-slide-outline-row', () => ({
  SortableSlideOutlineRow: ({ row, isSelected, onRangeSelect, onSelect }: {
    row: { slide: { id: string }; index: number };
    isSelected: boolean;
    onRangeSelect: (index: number, extend: boolean, toggle?: boolean) => void;
    onSelect: (index: number) => void;
  }) => (
    <button
      type="button"
      data-selected={isSelected ? 'true' : 'false'}
      onClick={(event) => {
        const toggleSelection = event.metaKey || event.ctrlKey;
        onRangeSelect(row.index, event.shiftKey, toggleSelection);
        if (!event.shiftKey && !toggleSelection) onSelect(row.index);
      }}
    >
      {row.slide.id}
    </button>
  ),
}));

vi.mock('../../../../../../apps/cast/renderer/features/items/slide-list-row', () => ({
  SlideOutlineRow: ({ row }: { row: { slide: { id: string } } }) => <div>overlay:{row.slide.id}</div>,
}));

afterEach(() => {
  cleanup();
  mocks.rootProps = null;
  mocks.virtualItems = [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 56 }];
  mocks.scrollToIndex.mockReset();
  mocks.measureElement.mockReset();
  mocks.onKeyboardMoveToIndex.mockReset();
  mocks.duplicateSlide.mockReset();
  mocks.deleteSlide.mockReset();
  mocks.confirm.mockReset().mockResolvedValue(true);
});

describe('SingleSlideList', () => {
  it('keeps generated boundaries fixed during keyboard reordering', () => {
    mocks.navigation.value = { currentItemRef: { type: 'lyric', id: 'song' } };
    mocks.outlineView.value = {
      rows: [
        { slide: { id: 'start', runtimeBlank: 'start' }, index: 0 },
        { slide: { id: 'authored' }, index: 1 },
        { slide: { id: 'end', runtimeBlank: 'end' }, index: 2 },
      ],
      currentSlideIndex: 1, selectSlide: vi.fn(), openSlide: vi.fn(),
    };
    mocks.slides.value = { reorderSlide: vi.fn() };
    mocks.scenes.value = { getThumbnailScene: vi.fn(() => ({ width: 1920, height: 1080 })) };
    render(<SingleSlideList />);
    const keyboard = (mocks.rootProps as { virtualizedKeyboard: { onMoveToIndex: (index: number) => void } }).virtualizedKeyboard;
    keyboard.onMoveToIndex(0);
    keyboard.onMoveToIndex(2);
    expect(mocks.onKeyboardMoveToIndex).not.toHaveBeenCalled();
    keyboard.onMoveToIndex(1);
    expect(mocks.onKeyboardMoveToIndex).toHaveBeenCalledWith(1);
  });

  it('renders a bounded subset and scrolls the selected offscreen slide into view through the virtualizer', () => {
    mocks.navigation.value = { currentItemRef: { type: 'presentation', id: 'item-1' } };
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

  it('keeps the active slide unchanged while Shift-click selects a contiguous range', () => {
    const selectSlide = vi.fn();
    mocks.navigation.value = { currentItemRef: { type: 'presentation', id: 'item-1' } };
    mocks.outlineView.value = {
      rows: Array.from({ length: 3 }, (_, index) => ({ slide: { id: `slide-${index}` }, index })),
      currentSlideIndex: 0,
      selectSlide,
      openSlide: vi.fn(),
    };
    mocks.slides.value = { reorderSlide: vi.fn() };
    mocks.scenes.value = { getThumbnailScene: vi.fn(() => ({ width: 1920, height: 1080 })) };
    mocks.virtualItems = [
      { index: 0, key: 'row-0', start: 0 },
      { index: 1, key: 'row-1', start: 56 },
      { index: 2, key: 'row-2', start: 112 },
    ];

    render(<SingleSlideList />);
    fireEvent.click(screen.getByRole('button', { name: 'slide-2' }), { shiftKey: true });

    expect(selectSlide).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'slide-0' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'slide-1' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'slide-2' }).getAttribute('data-selected')).toBe('true');
  });

  it('toggles a discontiguous slide without selecting it as the active slide', () => {
    const selectSlide = vi.fn();
    mocks.navigation.value = { currentItemRef: { type: 'presentation', id: 'item-1' } };
    mocks.outlineView.value = {
      rows: Array.from({ length: 4 }, (_, index) => ({ slide: { id: `slide-${index}` }, index })),
      currentSlideIndex: 0,
      selectSlide,
      openSlide: vi.fn(),
    };
    mocks.slides.value = { reorderSlide: vi.fn(), setCurrentSlideIndex: vi.fn() };
    mocks.scenes.value = { getThumbnailScene: vi.fn(() => ({ width: 1920, height: 1080 })) };
    mocks.virtualItems = Array.from({ length: 4 }, (_, index) => ({ index, key: `row-${index}`, start: index * 56 }));

    render(<SingleSlideList />);
    fireEvent.click(screen.getByRole('button', { name: 'slide-2' }), { metaKey: true });

    expect(selectSlide).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'slide-0' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'slide-1' }).getAttribute('data-selected')).toBe('false');
    expect(screen.getByRole('button', { name: 'slide-2' }).getAttribute('data-selected')).toBe('true');
  });

  it('handles selected-slide keyboard actions locally instead of falling through to the canvas', async () => {
    const slides = Array.from({ length: 3 }, (_, index) => ({ id: `slide-${index}` }));
    const selectSlide = vi.fn();
    mocks.navigation.value = { currentItemRef: { type: 'presentation', id: 'item-1' } };
    mocks.outlineView.value = {
      rows: slides.map((slide, index) => ({ slide, index })),
      currentSlideIndex: 0,
      selectSlide,
      openSlide: vi.fn(),
    };
    mocks.slides.value = {
      slides,
      reorderSlide: vi.fn(),
      setCurrentSlideIndex: vi.fn(),
      duplicateSlide: mocks.duplicateSlide,
      deleteSlide: mocks.deleteSlide,
    };
    mocks.scenes.value = { getThumbnailScene: vi.fn(() => ({ width: 1920, height: 1080 })) };
    mocks.virtualItems = slides.map((_, index) => ({ index, key: `row-${index}`, start: index * 56 }));
    mocks.confirm.mockResolvedValue(true);
    mocks.duplicateSlide.mockResolvedValue(undefined);
    mocks.deleteSlide.mockResolvedValue(undefined);
    const globalKeyboard = vi.fn();
    window.addEventListener('keydown', globalKeyboard);
    const view = render(<SingleSlideList />);

    fireEvent.click(screen.getByRole('button', { name: 'slide-2' }), { metaKey: true });
    fireEvent.keyDown(screen.getByRole('button', { name: 'slide-2' }), { key: 'd', metaKey: true });
    await waitFor(() => expect(mocks.duplicateSlide.mock.calls.map(([id]) => id)).toEqual(['slide-0', 'slide-2']));
    expect(globalKeyboard).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('button', { name: 'slide-2' }), { key: 'Delete' });
    await waitFor(() => expect(mocks.deleteSlide.mock.calls.map(([id]) => id)).toEqual(['slide-2', 'slide-0']));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(globalKeyboard).not.toHaveBeenCalled();
    window.removeEventListener('keydown', globalKeyboard);
    view.unmount();
  });
});
