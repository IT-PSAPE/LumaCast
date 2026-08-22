import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PlaylistRow } from '@lumacast/composition';
import { PlaylistRowList } from './playlist-row-list';

const mocks = vi.hoisted(() => ({
  navigation: { value: null as unknown },
  rootProps: null as null | Record<string, unknown>,
  virtualItems: [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 32 }],
  totalSize: 320,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('../../contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('../../components/layout/sortable-list', () => ({
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

vi.mock('./playlist-item-row', () => ({
  PlaylistItemRow: ({ row }: { row: { id: string } }) => <div>item:{row.id}</div>,
}));

vi.mock('./separator-row', () => ({
  SeparatorRow: ({ row }: { row: { id: string } }) => <div>separator:{row.id}</div>,
}));

afterEach(() => {
  cleanup();
  mocks.rootProps = null;
  mocks.virtualItems = [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 32 }];
  mocks.measureElement.mockReset();
  mocks.scrollToIndex.mockReset();
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
});
