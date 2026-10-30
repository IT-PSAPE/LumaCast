import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Playlist } from '@lumacast/composition';
import { PlaylistPanels } from '../../../../../../apps/cast/renderer/features/playlists/playlist-panels';

const mocks = vi.hoisted(() => ({
  navigation: { value: null as any },
  playlists: [] as Playlist[],
  options: null as null | Record<string, unknown>,
  rootProps: null as null | Record<string, unknown>,
  renderedRows: new Map<string, any>(),
  management: { deletePlaylist: vi.fn(), movePlaylist: vi.fn() },
  confirm: vi.fn(async () => true),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({ playlists: mocks.playlists }),
}));

vi.mock('../../../../../../apps/cast/renderer/contexts/app-context', () => ({
  useCast: () => ({ snapshot: {} }),
}));

vi.mock('../../../../../../apps/cast/renderer/features/playlists/use-playlist-panel-management', () => ({
  usePlaylistPanelManagement: () => mocks.management,
}));

vi.mock('../../../../../../apps/cast/renderer/features/playlists/playlist-rows-browser', () => ({ PlaylistRowsBrowser: () => null }));

vi.mock('../../../../../../apps/cast/renderer/components/layout/sortable-list', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../apps/cast/renderer/components/layout/sortable-list')>();
  return {
    ...actual,
    SortableList: {
      Root: ({ children, ...props }: { children: React.ReactNode }) => {
        mocks.rootProps = props;
        return <div>{children}</div>;
      },
    },
    useSortableOrder: ({ items, ...options }: { items: Playlist[] }) => {
      mocks.options = options;
      return { items, dnd: { ids: [], disabled: false } };
    },
  };
});

vi.mock('../../../../../../apps/cast/renderer/components/layout/panel-split/split-panel', async () => {
  const React = await import('react');
  const Wrapper = ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children);
  return { SplitPanel: { Panel: Wrapper, Segment: Wrapper } };
});

vi.mock('../../../../../../apps/cast/renderer/components/layout/panel', async () => {
  const React = await import('react');
  const Wrapper = ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children);
  return { LumaCastPanel: { Root: Wrapper } };
});

vi.mock('../../../../../../apps/cast/renderer/components/layout/scroll-area', async () => {
  const React = await import('react');
  const Wrapper = ({ children, ...props }: { children: React.ReactNode }) => React.createElement('div', props, children);
  return { ScrollArea: { Root: Wrapper, Viewport: Wrapper, Scrollbar: Wrapper, Thumb: () => null } };
});

vi.mock('@lumacast/ui', async () => {
  const React = await import('react');
  const Wrapper = ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children);
  const Panel = Object.assign(Wrapper, { Header: Wrapper, HeaderTitle: Wrapper, HeaderActions: Wrapper, Body: Wrapper });
  const Icon = ({ children, ...props }: { children: React.ReactNode }) => React.createElement('button', props, children);
  return {
    Panel,
    ReacstButton: { Icon },
    useConfirm: () => mocks.confirm,
  };
});

vi.mock('../../../../../../apps/cast/renderer/features/playlists/playlist-row', async () => {
  const React = await import('react');
  return {
    PlaylistRow: (props: any) => {
      mocks.renderedRows.set(props.playlist.id, props);
      return React.createElement('button', {
        type: 'button',
        'data-testid': `playlist-${props.playlist.id}`,
        'data-selected': props.isMultiSelected ? 'true' : 'false',
        onClick: (event) => {
          if (!props.onSelectionClick?.(props.playlist.id, event)) mocks.navigation.value.setCurrentPlaylistId(props.playlist.id);
        },
      }, props.playlist.name);
    },
  };
});

afterEach(() => {
  cleanup();
  mocks.options = null;
  mocks.rootProps = null;
  mocks.renderedRows.clear();
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.management.deletePlaylist.mockReset().mockResolvedValue(undefined);
  mocks.management.movePlaylist.mockReset().mockResolvedValue(undefined);
});

function setup() {
  mocks.playlists = [
    { id: 'playlist-1', name: 'One' },
    { id: 'playlist-2', name: 'Two' },
    { id: 'playlist-3', name: 'Three' },
  ] as Playlist[];
  mocks.navigation.value = {
    createPlaylist: vi.fn(),
    reorderPlaylist: vi.fn().mockResolvedValue(undefined),
    setCurrentPlaylistId: vi.fn(),
  };
  render(<PlaylistPanels />);
}

describe('PlaylistPanels', () => {
  it('supports modifier selection and exposes selected ids to grouped sorting', () => {
    setup();

    fireEvent.click(screen.getByTestId('playlist-playlist-1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('playlist-playlist-3'), { shiftKey: true });

    expect(mocks.navigation.value.setCurrentPlaylistId).not.toHaveBeenCalled();
    expect(screen.getByTestId('playlist-playlist-1').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('playlist-playlist-2').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('playlist-playlist-3').getAttribute('data-selected')).toBe('true');
    expect((mocks.options as { selectedIds: ReadonlySet<string> }).selectedIds).toEqual(new Set(['playlist-1', 'playlist-2', 'playlist-3']));
  });

  it('handles select-all and Escape within the playlist collection', () => {
    setup();
    const scope = document.querySelector('[data-shortcuts-scope="ignore"]');
    expect(scope).not.toBeNull();

    fireEvent.keyDown(scope!, { key: 'a', ctrlKey: true });
    expect(screen.getByTestId('playlist-playlist-1').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('playlist-playlist-2').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('playlist-playlist-3').getAttribute('data-selected')).toBe('true');

    fireEvent.keyDown(scope!, { key: 'Escape' });
    expect(screen.getByTestId('playlist-playlist-1').getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('playlist-playlist-2').getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('playlist-playlist-3').getAttribute('data-selected')).toBe('false');
  });

  it('persists a grouped playlist drag in stable order', async () => {
    setup();
    fireEvent.click(screen.getByTestId('playlist-playlist-1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('playlist-playlist-2'), { ctrlKey: true });

    const commit = (mocks.options as { commit: (change: unknown) => Promise<unknown> }).commit;
    await act(async () => {
      await commit({
        id: 'playlist-1',
        fromIndex: 0,
        toIndex: 2,
        movedIds: ['playlist-1', 'playlist-2'],
        previousIds: ['playlist-1', 'playlist-2', 'playlist-3'],
        orderedIds: ['playlist-3', 'playlist-1', 'playlist-2'],
      });
    });

    expect(mocks.navigation.value.reorderPlaylist.mock.calls).toEqual([['playlist-2', 2], ['playlist-1', 1]]);
  });

  it('moves selected playlists in reverse order when moving down and retains pending deletes after a failure', async () => {
    setup();
    fireEvent.click(screen.getByTestId('playlist-playlist-1'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('playlist-playlist-3'), { shiftKey: true });
    const props = mocks.renderedRows.get('playlist-3');
    const targets = props.actionPlaylists;

    await act(async () => { await props.onMovePlaylists(targets, 'down'); });
    expect(mocks.management.movePlaylist.mock.calls).toEqual([
      ['playlist-3', 'down'],
      ['playlist-2', 'down'],
      ['playlist-1', 'down'],
    ]);

    mocks.management.deletePlaylist.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('delete failed'));
    await act(async () => { await props.onDeletePlaylists(targets); });

    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.management.deletePlaylist.mock.calls).toEqual([['playlist-1'], ['playlist-2']]);
    expect(screen.getByTestId('playlist-playlist-1').getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('playlist-playlist-2').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('playlist-playlist-3').getAttribute('data-selected')).toBe('true');
  });
});
