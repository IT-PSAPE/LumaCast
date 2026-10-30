import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ItemType } from '@lumacast/composition';
import { BinControlsProvider } from '@renderer/components/controls/bin-controls';
import { DeckBinPanel } from '../../../../../../apps/cast/renderer/features/items/deck-bin-panel';

// Covers the deck bin empty-state change: each section with no items renders
// an accessible create drop-zone wired to the create-item flow, replacing the
// plain "No presentations yet." text.

const mocks = vi.hoisted(() => ({
  deckBin: { value: null as unknown },
  createItem: { value: null as unknown },
  navigation: { value: null as unknown },
  confirm: vi.fn(async () => true),
  renderedItems: new Map<string, any>(),
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

vi.mock('../../../../../../apps/cast/renderer/features/items/use-deck-bin', () => ({
  useDeckBin: () => mocks.deckBin.value,
}));

vi.mock('../../../../../../apps/cast/renderer/features/items/create-item', () => ({
  useCreateItem: () => mocks.createItem.value,
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('@lumacast/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lumacast/ui')>();
  return { ...actual, useConfirm: () => mocks.confirm };
});

vi.mock('../../../../../../apps/cast/renderer/features/items/item-bin-row', async () => {
  const React = await import('react');
  return {
    ItemBinRow: (props: any) => {
      const key = `${props.itemRef.type}:${props.itemRef.id}`;
      mocks.renderedItems.set(key, props);
      return React.createElement('button', {
        type: 'button',
        'data-testid': `item-${key}`,
        'data-selected': props.isMultiSelected ? 'true' : 'false',
        onClick: (event: React.MouseEvent<HTMLElement>) => props.onOpen(props.itemRef, event),
      }, props.item.title);
    },
  };
});

vi.mock('../../../../../../apps/cast/renderer/features/items/item-bin-tile', async () => {
  const React = await import('react');
  return {
    ItemBinTile: (props: any) => {
      const key = `${props.itemRef.type}:${props.itemRef.id}`;
      mocks.renderedItems.set(key, props);
      return React.createElement('button', {
        type: 'button',
        'data-testid': `item-${key}`,
        'data-selected': props.isMultiSelected ? 'true' : 'false',
        onClick: (event: React.MouseEvent<HTMLElement>) => props.onOpen(props.itemRef, event),
      }, props.item.title);
    },
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────

interface FakeItem {
  id: string;
  title: string;
  order?: number;
}

function makeEmptySections(): Array<{ type: ItemType; label: string; items: FakeItem[] }> {
  return [
    { type: 'lyric', label: 'Lyrics', items: [] },
    { type: 'presentation', label: 'Presentations', items: [] },
  ];
}

function renderDeckPanel(sections = makeEmptySections()) {
  const openCreateItem = vi.fn();
  const browseItem = vi.fn();

  mocks.deckBin.value = {
    sections,
    editingItemRef: null,
    browseItem,
    isDetachedDeckBrowser: false,
    currentDrawerItemRef: null,
    handleRename: vi.fn(),
    handleMove: vi.fn(),
    slidesByItem: new Map(),
  };
  mocks.createItem.value = { open: openCreateItem, close: vi.fn() };
  mocks.navigation.value = { deleteItem: vi.fn().mockResolvedValue(undefined), moveItem: vi.fn().mockResolvedValue(undefined) };
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.renderedItems.clear();

  const { container } = render(
    <BinControlsProvider
      searchValue=""
      onSearchChange={vi.fn()}
      viewMode="grid"
      onViewModeChange={vi.fn()}
      grid={null}
    >
      <DeckBinPanel />
    </BinControlsProvider>,
  );

  return { openCreateItem, browseItem, container };
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
  });

  it('opens the create-item flow for the section type when a drop-zone is activated', () => {
    const { openCreateItem } = renderDeckPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Create lyric' }));

    expect(openCreateItem).toHaveBeenCalledTimes(1);
    expect(openCreateItem).toHaveBeenCalledWith('lyric');
  });

  it('uses typed selection keys and modifier clicks do not open the deck item', () => {
    const sections = [
      { type: 'lyric' as const, label: 'Lyrics', items: [{ id: 'shared-id', title: 'Lyric' }] },
      { type: 'presentation' as const, label: 'Presentations', items: [{ id: 'shared-id', title: 'Presentation' }] },
    ];
    const { browseItem } = renderDeckPanel(sections);

    fireEvent.click(screen.getByTestId('item-lyric:shared-id'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('item-presentation:shared-id'), { shiftKey: true });

    expect(browseItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('item-lyric:shared-id').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('item-presentation:shared-id').getAttribute('data-selected')).toBe('true');
    expect(mocks.renderedItems.get('presentation:shared-id').actionItemRefs).toEqual([
      { type: 'lyric', id: 'shared-id' },
      { type: 'presentation', id: 'shared-id' },
    ]);

    fireEvent.click(screen.getByTestId('item-presentation:shared-id'));
    expect(browseItem).toHaveBeenCalledWith({ type: 'presentation', id: 'shared-id' });
  });

  it('keeps select-all and Escape local to the deck bin selection', () => {
    const sections = [
      { type: 'lyric' as const, label: 'Lyrics', items: [{ id: 'lyric-1', title: 'Lyric' }] },
      { type: 'presentation' as const, label: 'Presentations', items: [{ id: 'presentation-1', title: 'Presentation' }] },
    ];
    const { container } = renderDeckPanel(sections);
    const scope = container.querySelector('[data-shortcuts-scope="ignore"]');
    expect(scope).not.toBeNull();

    fireEvent.keyDown(scope!, { key: 'a', ctrlKey: true });
    expect(screen.getByTestId('item-lyric:lyric-1').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('item-presentation:presentation-1').getAttribute('data-selected')).toBe('true');

    fireEvent.keyDown(scope!, { key: 'Escape' });
    expect(screen.getByTestId('item-lyric:lyric-1').getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('item-presentation:presentation-1').getAttribute('data-selected')).toBe('false');
  });

  it('confirms once, deletes selected items in visible order, and leaves the failed item selected', async () => {
    const sections = [
      { type: 'lyric' as const, label: 'Lyrics', items: [{ id: 'lyric-1', title: 'Lyric one' }, { id: 'lyric-2', title: 'Lyric two' }] },
      { type: 'presentation' as const, label: 'Presentations', items: [{ id: 'presentation-1', title: 'Presentation' }] },
    ];
    renderDeckPanel(sections);
    fireEvent.click(screen.getByTestId('item-lyric:lyric-1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('item-presentation:presentation-1'), { ctrlKey: true });

    const deleteItem = (mocks.navigation.value as { deleteItem: ReturnType<typeof vi.fn> }).deleteItem;
    deleteItem.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('delete failed'));
    const selectedRefs = mocks.renderedItems.get('presentation:presentation-1').actionItemRefs;
    await act(async () => { await mocks.renderedItems.get('presentation:presentation-1').onDeleteItems(selectedRefs); });

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(deleteItem.mock.calls).toEqual([[{ type: 'lyric', id: 'lyric-1' }], [{ type: 'presentation', id: 'presentation-1' }]]);
    expect(screen.getByTestId('item-presentation:presentation-1').getAttribute('data-selected')).toBe('true');
  });

  it('moves a selected group in persisted order when the deck bin is sorted differently', async () => {
    const sections = [
      {
        type: 'lyric' as const,
        label: 'Lyrics',
        items: [
          { id: 'D', title: 'D', order: 3 },
          { id: 'C', title: 'C', order: 2 },
          { id: 'B', title: 'B', order: 1 },
          { id: 'A', title: 'A', order: 0 },
        ],
      },
      { type: 'presentation' as const, label: 'Presentations', items: [] },
    ];
    renderDeckPanel(sections);

    fireEvent.click(screen.getByTestId('item-lyric:B'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('item-lyric:C'), { ctrlKey: true });

    const navigation = mocks.navigation.value as { moveItem: ReturnType<typeof vi.fn> };
    const selectedRefs = mocks.renderedItems.get('lyric:C').actionItemRefs;
    await act(async () => { await mocks.renderedItems.get('lyric:C').onMoveItems(selectedRefs, 'up'); });

    expect(navigation.moveItem.mock.calls).toEqual([
      [{ type: 'lyric', id: 'B' }, 'up'],
      [{ type: 'lyric', id: 'C' }, 'up'],
    ]);
  });
});
