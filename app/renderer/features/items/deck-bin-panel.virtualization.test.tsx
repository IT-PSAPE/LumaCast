import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BinControlsProvider } from '@renderer/components/controls/bin-controls';
import { DeckBinPanel } from './deck-bin-panel';

const mocks = vi.hoisted(() => ({
  deckBin: { value: null as unknown },
  createItem: { value: null as unknown },
  virtualItems: [
    { index: 0, key: 'row-0', start: 0 },
    { index: 1, key: 'row-1', start: 32 },
    { index: 3, key: 'row-3', start: 96 },
    { index: 4, key: 'row-4', start: 128 },
  ],
  totalSize: 400,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('./use-deck-bin', () => ({
  useDeckBin: () => mocks.deckBin.value,
}));

vi.mock('./create-item', () => ({
  useCreateItem: () => mocks.createItem.value,
}));

vi.mock('./use-duplicate-item', () => ({
  useDuplicateItem: vi.fn(),
}));

vi.mock('../../contexts/app-context', () => ({
  useCast: () => ({
    mutatePatch: vi.fn(),
    setStatusText: vi.fn(),
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

vi.mock('./item-bin-row', () => ({
  ItemBinRow: ({ item }: { item: { title: string } }) => <div>{item.title}</div>,
}));

vi.mock('./item-bin-tile', () => ({
  ItemBinTile: ({ item }: { item: { title: string } }) => <div>{item.title}</div>,
}));

function renderPanel() {
  mocks.createItem.value = { open: vi.fn(), close: vi.fn() };
  mocks.deckBin.value = {
    sections: [
      { type: 'presentation', label: 'Presentations', items: [{ id: 'p-1', title: 'Deck A' }, { id: 'p-2', title: 'Deck B' }] },
      { type: 'lyric', label: 'Lyrics', items: [] },
      { type: 'talk', label: 'Talks', items: [{ id: 't-1', title: 'Talk A' }] },
    ],
    editingItemRef: null,
    browseItem: vi.fn(),
    isDetachedDeckBrowser: false,
    currentDrawerItemRef: null,
    handleRename: vi.fn(),
    handleMove: vi.fn(),
    slidesByItem: new Map(),
  };

  render(
    <BinControlsProvider
      searchValue=""
      onSearchChange={vi.fn()}
      searchPlaceholder="Search…"
      viewMode="list"
      onViewModeChange={vi.fn()}
      grid={null}
    >
      <DeckBinPanel />
    </BinControlsProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.measureElement.mockReset();
  mocks.scrollToIndex.mockReset();
});

describe('DeckBinPanel virtualization', () => {
  it('keeps section headers and empty sections while windowing grouped rows', () => {
    renderPanel();

    expect(screen.getByText('Presentations')).not.toBeNull();
    expect(screen.getByText('Deck A')).not.toBeNull();
    expect(screen.queryByText('Deck B')).toBeNull();
    expect(screen.getByText('Lyrics')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create lyric' })).not.toBeNull();
    expect(screen.queryByText('Talk A')).toBeNull();
  });
});
