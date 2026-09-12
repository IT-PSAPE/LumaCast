import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BinControlsProvider } from '@renderer/components/controls/bin-controls';
import { DeckBinPanel } from '../../../../../app/renderer/features/items/deck-bin-panel';

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

vi.mock('../../../../../app/renderer/features/items/use-deck-bin', () => ({
  useDeckBin: () => mocks.deckBin.value,
}));

vi.mock('../../../../../app/renderer/features/items/create-item', () => ({
  useCreateItem: () => mocks.createItem.value,
}));

vi.mock('../../../../../app/renderer/features/items/use-duplicate-item', () => ({
  useDuplicateItem: vi.fn(),
}));

vi.mock('../../../../../app/renderer/contexts/app-context', () => ({
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

vi.mock('../../../../../app/renderer/features/items/item-bin-row', () => ({
  ItemBinRow: ({ item }: { item: { title: string } }) => <div>{item.title}</div>,
}));

vi.mock('../../../../../app/renderer/features/items/item-bin-tile', () => ({
  ItemBinTile: ({ item }: { item: { title: string } }) => <div>{item.title}</div>,
}));

function renderPanel() {
  mocks.createItem.value = { open: vi.fn(), close: vi.fn() };
  mocks.deckBin.value = {
    sections: [
      { type: 'presentation', label: 'Presentations', items: [{ id: 'p-1', title: 'Deck A' }, { id: 'p-2', title: 'Deck B' }] },
      { type: 'lyric', label: 'Lyrics', items: [] },
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
  });
});
