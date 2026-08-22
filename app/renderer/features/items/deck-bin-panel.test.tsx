import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ItemType } from '@lumacast/composition';
import { BinControlsProvider } from '@renderer/components/controls/bin-controls';
import { DeckBinPanel } from './deck-bin-panel';

// Covers the deck bin empty-state change: each section with no items renders
// an accessible create drop-zone wired to the create-item flow, replacing the
// plain "No presentations yet." text.

const mocks = vi.hoisted(() => ({
  deckBin: { value: null as unknown },
  createItem: { value: null as unknown },
}));

const virtualizerMocks = vi.hoisted(() => ({
  virtualItems: Array.from({ length: 6 }, (_, index) => ({ index, key: `row-${index}`, start: index * 40 })),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(() => ({
    getVirtualItems: () => virtualizerMocks.virtualItems,
    getTotalSize: () => 240,
    measureElement: virtualizerMocks.measureElement,
    scrollToIndex: virtualizerMocks.scrollToIndex,
  })),
}));

vi.mock('./use-deck-bin', () => ({
  useDeckBin: () => mocks.deckBin.value,
}));

vi.mock('./create-item', () => ({
  useCreateItem: () => mocks.createItem.value,
}));

// ─── Fixtures ────────────────────────────────────────────────────────

interface FakeItem {
  id: string;
  title: string;
}

function makeEmptySections(): Array<{ type: ItemType; label: string; items: FakeItem[] }> {
  return [
    { type: 'presentation', label: 'Presentations', items: [] },
    { type: 'lyric', label: 'Lyrics', items: [] },
    { type: 'talk', label: 'Talks', items: [] },
  ];
}

function renderDeckPanel() {
  const openCreateItem = vi.fn();

  mocks.deckBin.value = {
    sections: makeEmptySections(),
    editingItemRef: null,
    browseItem: vi.fn(),
    isDetachedDeckBrowser: false,
    currentDrawerItemRef: null,
    handleRename: vi.fn(),
    handleMove: vi.fn(),
    slidesByItem: new Map(),
  };
  mocks.createItem.value = { open: openCreateItem, close: vi.fn() };

  render(
    <BinControlsProvider
      searchValue=""
      onSearchChange={vi.fn()}
      searchPlaceholder="Search…"
      viewMode="grid"
      onViewModeChange={vi.fn()}
      grid={null}
    >
      <DeckBinPanel />
    </BinControlsProvider>,
  );

  return { openCreateItem };
}

afterEach(() => {
  cleanup();
});

describe('DeckBinPanel', () => {
  it('replaces the plain empty text with an accessible create drop-zone per empty section', () => {
    renderDeckPanel();

    expect(screen.queryByText('No presentations yet.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create presentation' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create lyric' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create talk' })).not.toBeNull();
  });

  it('opens the create-item flow for the section type when a drop-zone is activated', () => {
    const { openCreateItem } = renderDeckPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Create talk' }));

    expect(openCreateItem).toHaveBeenCalledTimes(1);
    expect(openCreateItem).toHaveBeenCalledWith('talk');
  });
});
