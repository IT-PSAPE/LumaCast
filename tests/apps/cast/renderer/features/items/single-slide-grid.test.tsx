import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SingleSlideGrid } from '../../../../../../apps/cast/renderer/features/items/single-slide-grid';

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
  onKeyboardMoveToIndex: vi.fn(),
  duplicateSlide: vi.fn(),
  deleteSlide: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@lumacast/ui', async () => {
  const actual = await vi.importActual<typeof import('@lumacast/ui')>('@lumacast/ui');
  return { ...actual, useConfirm: () => mocks.confirm };
});

vi.mock('../../../../../../apps/cast/renderer/contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/slide-context', () => ({
  useSlides: () => mocks.slides.value,
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/canvas/canvas-context', () => ({
  useThumbnailScene: () => (mocks.scenes.value as { getThumbnailScene: () => unknown }).getThumbnailScene,
}));

vi.mock('../../../../../../apps/cast/renderer/features/items/deck-browser-context', () => ({
  useDeckBrowser: () => mocks.deckBrowser.value,
}));

vi.mock('../../../../../../apps/cast/renderer/features/items/use-slide-reorder', () => ({
  useSlideReorder: (items: unknown[]) => ({
    items,
    dnd: {
      ids: [],
      disabled: false,
      onKeyboardMoveToIndex: mocks.onKeyboardMoveToIndex,
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

vi.mock('../../../../../../apps/cast/renderer/features/items/sortable-slide-grid-tile', () => ({
  SortableSlideGridTile: ({ slideId, index, selected, isGenerated, onRangeSelect, onActivate }: {
    slideId: string;
    index: number;
    selected: boolean;
    isGenerated?: boolean;
    onRangeSelect: (index: number, extend: boolean, toggle?: boolean) => void;
    onActivate: (index: number) => void;
  }) => (
    <button
      type="button"
      data-selected={selected ? 'true' : 'false'}
      data-generated={isGenerated ? 'true' : 'false'}
      onClick={(event) => {
        const toggleSelection = event.metaKey || event.ctrlKey;
        onRangeSelect(index, event.shiftKey, toggleSelection);
        if (!event.shiftKey && !toggleSelection) onActivate(index);
      }}
    >
      {slideId}
    </button>
  ),
}));

vi.mock('../../../../../../apps/cast/renderer/features/items/slide-grid-tile', () => ({
  SlideGridTile: ({ slideId }: { slideId: string }) => <div>overlay:{slideId}</div>,
}));

afterEach(() => {
  cleanup();
  mocks.rootProps = null;
  mocks.measureElement.mockReset();
  mocks.scrollToIndex.mockReset();
  mocks.onKeyboardMoveToIndex.mockReset();
  mocks.duplicateSlide.mockReset();
  mocks.deleteSlide.mockReset();
  mocks.confirm.mockReset().mockResolvedValue(true);
});

describe('SingleSlideGrid', () => {
  it('shows and activates generated boundaries in sequence and rejects keyboard reorder into them', () => {
    const activateSlide = vi.fn();
    mocks.navigation.value = {
      currentItemRef: { type: 'lyric', id: 'song' }, currentOutputItemRef: null, isDetachedDeckBrowser: false,
    };
    mocks.slides.value = {
      slides: [{ id: 'blank-start', runtimeBlank: 'start' }, { id: 'authored' }, { id: 'blank-end', runtimeBlank: 'end' }],
      currentSlideIndex: 0, liveSlideIndex: -1, slideElementsById: new Map(),
      activateSlide, setCurrentSlideIndex: vi.fn(), reorderSlide: vi.fn(),
    };
    mocks.scenes.value = { getThumbnailScene: vi.fn(() => ({ width: 1920, height: 1080 })) };
    mocks.deckBrowser.value = { gridItemSize: 3 };
    render(<SingleSlideGrid />);

    expect(screen.getByRole('button', { name: 'blank-start' })).toHaveAttribute('data-generated', 'true');
    expect(screen.getByRole('button', { name: 'blank-end' })).toHaveAttribute('data-generated', 'true');
    expect(screen.getByRole('button', { name: 'authored' })).toHaveAttribute('data-generated', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'blank-end' }));
    expect(activateSlide).toHaveBeenCalledWith(2);
    const keyboard = (mocks.rootProps as { virtualizedKeyboard: { onMoveToIndex: (index: number) => void } }).virtualizedKeyboard;
    keyboard.onMoveToIndex(0);
    keyboard.onMoveToIndex(2);
    expect(mocks.onKeyboardMoveToIndex).not.toHaveBeenCalled();
    keyboard.onMoveToIndex(1);
    expect(mocks.onKeyboardMoveToIndex).toHaveBeenCalledWith(1);
  });

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

  it('extends selection in document order without activating the Shift-clicked slide', () => {
    const activateSlide = vi.fn();
    mocks.navigation.value = {
      currentItemRef: { type: 'presentation', id: 'item-1' },
      currentOutputItemRef: { type: 'presentation', id: 'item-1' },
      isDetachedDeckBrowser: false,
    };
    mocks.slides.value = {
      slides: Array.from({ length: 4 }, (_, index) => ({ id: `slide-${index}` })),
      currentSlideIndex: 0,
      liveSlideIndex: -1,
      slideElementsById: new Map(),
      activateSlide,
      setCurrentSlideIndex: vi.fn(),
      reorderSlide: vi.fn(),
    };
    mocks.scenes.value = { getThumbnailScene: vi.fn(() => ({ width: 1920, height: 1080 })) };
    mocks.deckBrowser.value = { gridItemSize: 3 };

    render(<SingleSlideGrid />);
    fireEvent.click(screen.getByRole('button', { name: 'slide-0' }));
    fireEvent.click(screen.getByRole('button', { name: 'slide-2' }), { shiftKey: true });

    expect(activateSlide).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'slide-0' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'slide-1' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'slide-2' }).getAttribute('data-selected')).toBe('true');
  });

  it('toggles a discontiguous slide without activating it', () => {
    const activateSlide = vi.fn();
    mocks.navigation.value = {
      currentItemRef: { type: 'presentation', id: 'item-1' },
      currentOutputItemRef: { type: 'presentation', id: 'item-1' },
      isDetachedDeckBrowser: false,
    };
    mocks.slides.value = {
      slides: Array.from({ length: 4 }, (_, index) => ({ id: `slide-${index}` })),
      currentSlideIndex: 0,
      liveSlideIndex: -1,
      slideElementsById: new Map(),
      activateSlide,
      setCurrentSlideIndex: vi.fn(),
      reorderSlide: vi.fn(),
    };
    mocks.scenes.value = { getThumbnailScene: vi.fn(() => ({ width: 1920, height: 1080 })) };
    mocks.deckBrowser.value = { gridItemSize: 3 };

    render(<SingleSlideGrid />);
    fireEvent.click(screen.getByRole('button', { name: 'slide-2' }), { ctrlKey: true });

    expect(activateSlide).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'slide-0' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'slide-1' }).getAttribute('data-selected')).toBe('false');
    expect(screen.getByRole('button', { name: 'slide-2' }).getAttribute('data-selected')).toBe('true');
  });

  it('routes Delete and Ctrl+D to the selected slides and stops global keyboard handling', async () => {
    const activateSlide = vi.fn();
    mocks.navigation.value = {
      currentItemRef: { type: 'presentation', id: 'item-1' },
      currentOutputItemRef: { type: 'presentation', id: 'item-1' },
      isDetachedDeckBrowser: false,
    };
    mocks.slides.value = {
      slides: Array.from({ length: 3 }, (_, index) => ({ id: `slide-${index}` })),
      currentSlideIndex: 0,
      liveSlideIndex: -1,
      slideElementsById: new Map(),
      activateSlide,
      setCurrentSlideIndex: vi.fn(),
      reorderSlide: vi.fn(),
      duplicateSlide: mocks.duplicateSlide,
      deleteSlide: mocks.deleteSlide,
    };
    mocks.scenes.value = { getThumbnailScene: vi.fn(() => ({ width: 1920, height: 1080 })) };
    mocks.deckBrowser.value = { gridItemSize: 3 };
    mocks.confirm.mockResolvedValue(true);
    mocks.duplicateSlide.mockResolvedValue(undefined);
    mocks.deleteSlide.mockResolvedValue(undefined);
    const globalKeyboard = vi.fn();
    window.addEventListener('keydown', globalKeyboard);
    const view = render(<SingleSlideGrid />);

    fireEvent.click(screen.getByRole('button', { name: 'slide-2' }), { ctrlKey: true });
    fireEvent.keyDown(screen.getByRole('button', { name: 'slide-2' }), { key: 'Delete' });
    await waitFor(() => expect(mocks.deleteSlide.mock.calls.map(([id]) => id)).toEqual(['slide-2', 'slide-0']));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(globalKeyboard).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('button', { name: 'slide-2' }), { key: 'd', ctrlKey: true });
    await waitFor(() => expect(mocks.duplicateSlide.mock.calls.map(([id]) => id)).toEqual(['slide-0', 'slide-2']));
    expect(globalKeyboard).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('button', { name: 'slide-2' }), { key: 'a', ctrlKey: true });
    expect(screen.getAllByRole('button').every((button) => button.getAttribute('data-selected') === 'true')).toBe(true);
    fireEvent.keyDown(screen.getByRole('button', { name: 'slide-2' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'slide-0' }).getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'slide-1' }).getAttribute('data-selected')).toBe('false');
    expect(globalKeyboard).not.toHaveBeenCalled();
    window.removeEventListener('keydown', globalKeyboard);
    view.unmount();
  });
});
