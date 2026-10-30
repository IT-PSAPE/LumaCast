import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlaylistRow } from '@lumacast/composition';
import { PlaylistRowList } from '../../../../../../apps/cast/renderer/features/playlists/playlist-row-list';

const mocks = vi.hoisted(() => ({
  navigation: { value: null as unknown },
  rootProps: null as null | Record<string, unknown>,
  sortOptions: null as null | Record<string, unknown>,
  virtualItems: [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 32 }],
  totalSize: 320,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  confirm: vi.fn(async () => true),
  renderedRows: new Map<string, any>(),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('../../../../../../apps/cast/renderer/components/layout/sortable-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../apps/cast/renderer/components/layout/sortable-list')>();
  return {
    ...actual,
    SortableList: {
      Root: ({ children, ...props }: { children: React.ReactNode }) => {
        mocks.rootProps = props;
        return <div data-testid="sortable-root">{children}</div>;
      },
    },
    VIRTUALIZED_SORTABLE_MEASURING: { droppable: { strategy: 0 } },
    useSortableOrder: ({ items, ...options }: { items: unknown[] }) => {
      mocks.sortOptions = options;
      return { items, dnd: { ids: [], disabled: false, onDragStart: vi.fn(), onDragEnd: vi.fn(), onDragCancel: vi.fn() } };
    },
  };
});

vi.mock('@lumacast/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lumacast/ui')>();
  return { ...actual, useConfirm: () => mocks.confirm };
});

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(() => ({
    getVirtualItems: () => mocks.virtualItems,
    getTotalSize: () => mocks.totalSize,
    measureElement: mocks.measureElement,
    scrollToIndex: mocks.scrollToIndex,
  })),
}));

vi.mock('../../../../../../apps/cast/renderer/features/playlists/playlist-item-row', async () => {
  const React = await import('react');
  return {
    PlaylistItemRow: (props: any) => {
      mocks.renderedRows.set(props.row.id, props);
      return React.createElement('button', {
        type: 'button',
        'data-testid': `row-${props.row.id}`,
        'data-selected': props.isMultiSelected ? 'true' : 'false',
        onClick: (event) => props.onSelectionClick?.(props.row.id, event),
        onDragOver: props.onDragOver,
      }, `item:${props.row.id}`);
    },
  };
});

vi.mock('../../../../../../apps/cast/renderer/features/playlists/separator-row', async () => {
  const React = await import('react');
  return {
    SeparatorRow: (props: any) => {
      mocks.renderedRows.set(props.row.id, props);
      return React.createElement('button', {
        type: 'button',
        'data-testid': `row-${props.row.id}`,
        'data-selected': props.isMultiSelected ? 'true' : 'false',
        onClick: (event) => props.onSelectionClick?.(props.row.id, event),
        onDragOver: props.onDragOver,
      }, `separator:${props.row.id}`);
    },
  };
});

afterEach(() => {
  cleanup();
  mocks.rootProps = null;
  mocks.sortOptions = null;
  mocks.virtualItems = [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 32 }];
  mocks.measureElement.mockReset();
  mocks.scrollToIndex.mockReset();
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.renderedRows.clear();
});

describe('PlaylistRowList', () => {
  it('renders only the visible row subset while preserving flat playlist row ordering', () => {
    mocks.navigation.value = {
      addItemToPlaylist: vi.fn(),
      movePlaylistRow: vi.fn(),
    };

    const rows = [
      { id: 'entry-1', kind: 'item' },
      { id: 'sep-1', kind: 'separator' },
      { id: 'entry-2', kind: 'item' },
    ] as PlaylistRow[];

    render(<PlaylistRowList rows={rows} playlistId="playlist-1" getScrollElement={() => null} />);

    expect(screen.getByText('item:entry-1')).not.toBeNull();
    expect(screen.getByText('separator:sep-1')).not.toBeNull();
    expect(screen.queryByText('item:entry-2')).toBeNull();

    const virtualizedKeyboard = (mocks.rootProps as { virtualizedKeyboard: { scrollToIndex: (index: number) => void } }).virtualizedKeyboard;
    virtualizedKeyboard.scrollToIndex(17);
    expect(mocks.scrollToIndex).toHaveBeenLastCalledWith(17, { align: 'auto' });
  });

  it('accepts an item drop anywhere in the full-height playlist surface', () => {
    const addItemToPlaylist = vi.fn().mockResolvedValue(undefined);
    mocks.navigation.value = { addItemToPlaylist, movePlaylistRow: vi.fn() };
    const rows = [{ id: 'entry-1', kind: 'item' }] as PlaylistRow[];
    render(<PlaylistRowList rows={rows} playlistId="playlist-1" getScrollElement={() => null} />);

    const surface = screen.getByTestId('playlist-row-drop-surface');
    expect(surface.className).toContain('h-full');
    const dataTransfer = {
      types: ['application/x-lumacast-item'],
      dropEffect: 'none',
      getData: () => JSON.stringify({ itemType: 'lyric', itemId: 'lyric-1' }),
    };
    fireEvent.dragOver(surface, { dataTransfer });
    fireEvent.drop(surface, { dataTransfer });

    expect(addItemToPlaylist).toHaveBeenCalledWith(
      'playlist-1',
      { type: 'lyric', id: 'lyric-1' },
      rows.length,
    );
  });

  it('makes an empty playlist drop surface fill its resized parent', () => {
    mocks.navigation.value = { addItemToPlaylist: vi.fn(), movePlaylistRow: vi.fn() };
    mocks.virtualItems = [];
    render(<PlaylistRowList rows={[]} playlistId="playlist-1" getScrollElement={() => null} />);
    expect(screen.getByTestId('playlist-row-drop-surface').className).toContain('h-full');
  });

  it('keeps before-row and end-of-list drop indicators inside their virtualized row slots', () => {
    mocks.navigation.value = { addItemToPlaylist: vi.fn(), movePlaylistRow: vi.fn() };
    const rows = [
      { id: 'entry-1', kind: 'item' },
      { id: 'entry-2', kind: 'item' },
    ] as PlaylistRow[];
    render(<PlaylistRowList rows={rows} playlistId="playlist-1" getScrollElement={() => null} />);

    const dataTransfer = { types: ['application/x-lumacast-item'], dropEffect: 'none' };
    const first = screen.getByTestId('row-entry-1');
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 32 } as DOMRect);
    fireEvent.dragOver(first, { clientY: 1, dataTransfer });
    expect(first.previousElementSibling?.querySelector('.bg-brand')).not.toBeNull();

    const last = screen.getByTestId('row-entry-2');
    vi.spyOn(last, 'getBoundingClientRect').mockReturnValue({ top: 32, height: 32 } as DOMRect);
    fireEvent.dragOver(last, { clientY: 63, dataTransfer });
    expect(last.nextElementSibling?.querySelector('.bg-brand')).not.toBeNull();
  });

  it('selects a shift range across entries and separators and passes it to sortable ordering', () => {
    mocks.navigation.value = { addItemToPlaylist: vi.fn(), movePlaylistRow: vi.fn().mockResolvedValue(undefined), removePlaylistRow: vi.fn() };
    mocks.virtualItems = [
      { index: 0, key: 'row-0', start: 0 },
      { index: 1, key: 'row-1', start: 32 },
      { index: 2, key: 'row-2', start: 64 },
    ];
    const rows = [
      { id: 'entry-1', kind: 'item' },
      { id: 'separator-1', kind: 'separator' },
      { id: 'entry-2', kind: 'item' },
    ] as PlaylistRow[];
    render(<PlaylistRowList rows={rows} playlistId="playlist-1" getScrollElement={() => null} />);

    fireEvent.click(screen.getByTestId('row-entry-1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('row-entry-2'), { shiftKey: true });

    expect(screen.getByTestId('row-entry-1').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('row-separator-1').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('row-entry-2').getAttribute('data-selected')).toBe('true');
    expect((mocks.sortOptions as { selectedIds: ReadonlySet<string> }).selectedIds).toEqual(new Set(['entry-1', 'separator-1', 'entry-2']));
  });

  it('handles select-all and Escape within the playlist rows', () => {
    mocks.navigation.value = { addItemToPlaylist: vi.fn(), movePlaylistRow: vi.fn().mockResolvedValue(undefined) };
    mocks.virtualItems = Array.from({ length: 2 }, (_, index) => ({ index, key: `row-${index}`, start: index * 32 }));
    const rows = [
      { id: 'entry-1', kind: 'item' },
      { id: 'separator-1', kind: 'separator' },
    ] as PlaylistRow[];
    const { container } = render(<PlaylistRowList rows={rows} playlistId="playlist-1" getScrollElement={() => null} />);
    const scope = container.querySelector('[data-shortcuts-scope="ignore"]');
    expect(scope).not.toBeNull();

    fireEvent.keyDown(scope!, { key: 'a', metaKey: true });
    expect(screen.getByTestId('row-entry-1').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('row-separator-1').getAttribute('data-selected')).toBe('true');

    fireEvent.keyDown(scope!, { key: 'Escape' });
    expect(screen.getByTestId('row-entry-1').getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('row-separator-1').getAttribute('data-selected')).toBe('false');
  });

  it('confirms once, stops after a failed bulk removal, and keeps failed and pending rows selected', async () => {
    const removePlaylistRow = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('remove failed'));
    mocks.navigation.value = {
      addItemToPlaylist: vi.fn(),
      movePlaylistRow: vi.fn().mockResolvedValue(undefined),
      removePlaylistRow,
    };
    mocks.virtualItems = [
      { index: 0, key: 'row-0', start: 0 },
      { index: 1, key: 'row-1', start: 32 },
      { index: 2, key: 'row-2', start: 64 },
    ];
    const rows = [
      { id: 'entry-1', kind: 'item' },
      { id: 'separator-1', kind: 'separator' },
      { id: 'entry-2', kind: 'item' },
    ] as PlaylistRow[];
    render(<PlaylistRowList rows={rows} playlistId="playlist-1" getScrollElement={() => null} />);
    fireEvent.click(screen.getByTestId('row-entry-1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('row-entry-2'), { shiftKey: true });

    const selectedRows = mocks.renderedRows.get('entry-2').actionRows;
    await act(async () => { await mocks.renderedRows.get('entry-2').onRemoveRows(selectedRows); });

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(removePlaylistRow.mock.calls).toEqual([['entry-1'], ['separator-1']]);
    expect(screen.getByTestId('row-entry-1').getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('row-separator-1').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('row-entry-2').getAttribute('data-selected')).toBe('true');
  });

  it('persists grouped row reorders in an order that preserves the selected block', async () => {
    const movePlaylistRow = vi.fn().mockResolvedValue(undefined);
    mocks.navigation.value = { addItemToPlaylist: vi.fn(), movePlaylistRow, removePlaylistRow: vi.fn() };
    mocks.virtualItems = Array.from({ length: 5 }, (_, index) => ({ index, key: `row-${index}`, start: index * 32 }));
    const rows = [
      { id: 'row-a', kind: 'item' },
      { id: 'row-b', kind: 'item' },
      { id: 'separator-c', kind: 'separator' },
      { id: 'row-d', kind: 'item' },
      { id: 'row-e', kind: 'item' },
    ] as PlaylistRow[];
    render(<PlaylistRowList rows={rows} playlistId="playlist-1" getScrollElement={() => null} />);
    fireEvent.click(screen.getByTestId('row-row-b'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('row-row-d'), { ctrlKey: true });

    const commit = (mocks.sortOptions as { commit: (change: unknown) => Promise<unknown> }).commit;
    await act(async () => {
      await commit({
        id: 'row-b',
        fromIndex: 1,
        toIndex: 4,
        movedIds: ['row-b', 'row-d'],
        previousIds: ['row-a', 'row-b', 'separator-c', 'row-d', 'row-e'],
        orderedIds: ['row-a', 'separator-c', 'row-e', 'row-b', 'row-d'],
      });
    });

    expect(movePlaylistRow.mock.calls).toEqual([['row-d', 4], ['row-b', 3]]);
  });

  it('persists three discontiguous selected rows packed near the middle without reversing mixed-direction moves', async () => {
    const movePlaylistRow = vi.fn().mockResolvedValue(undefined);
    mocks.navigation.value = { addItemToPlaylist: vi.fn(), movePlaylistRow, removePlaylistRow: vi.fn() };
    mocks.virtualItems = Array.from({ length: 5 }, (_, index) => ({ index, key: `row-${index}`, start: index * 32 }));
    const rows = [
      { id: 'row-a', kind: 'item' },
      { id: 'row-b', kind: 'item' },
      { id: 'separator-c', kind: 'separator' },
      { id: 'row-d', kind: 'item' },
      { id: 'row-e', kind: 'item' },
    ] as PlaylistRow[];
    render(<PlaylistRowList rows={rows} playlistId="playlist-1" getScrollElement={() => null} />);
    fireEvent.click(screen.getByTestId('row-row-a'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('row-row-d'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('row-row-e'), { ctrlKey: true });

    const commit = (mocks.sortOptions as { commit: (change: unknown) => Promise<unknown> }).commit;
    await act(async () => {
      await commit({
        id: 'row-a',
        fromIndex: 0,
        toIndex: 1,
        movedIds: ['row-a', 'row-d', 'row-e'],
        previousIds: ['row-a', 'row-b', 'separator-c', 'row-d', 'row-e'],
        orderedIds: ['row-b', 'row-a', 'row-d', 'row-e', 'separator-c'],
      });
    });

    expect(movePlaylistRow.mock.calls).toEqual([
      ['row-d', 2],
      ['row-e', 3],
      ['row-a', 1],
    ]);
  });
});
