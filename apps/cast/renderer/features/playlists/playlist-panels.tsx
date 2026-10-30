import { useCallback } from 'react';
import { Plus } from 'lucide-react';
import type { Id } from '@lumacast/kernel';
import type { Playlist } from '@lumacast/composition';
import { useNavigation } from '@renderer/contexts/navigation-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useCast } from '@renderer/contexts/app-context';
import { Panel, ReacstButton, useConfirm } from '@lumacast/ui';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { SortableList, useSortableOrder } from '@renderer/components/layout/sortable-list';
import { commitSelectedReorder } from '@lumacast/selection';
import type { SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { PlaylistRowsBrowser } from './playlist-rows-browser';
import { PlaylistRow } from './playlist-row';
import { usePlaylistPanelManagement } from './use-playlist-panel-management';
import { useMultiSelection, useMultiSelectionKeyHandler } from '@lumacast/selection';

// #219 item-model refactor decision D4: playlists are global — there is no
// library hierarchy above them any more, so this panel is just "the list of
// playlists" plus the rows of whichever one is selected. No back-to-libraries
// chevron, no library name header.
const playlistId = (playlist: Playlist) => playlist.id;

export function PlaylistPanels() {
  const { createPlaylist, reorderPlaylist } = useNavigation();
  const { snapshot } = useCast();
  const { playlists: orderedPlaylists } = useProjectContent();
  const { deletePlaylist, movePlaylist } = usePlaylistPanelManagement();
  const confirm = useConfirm();
  const orderedPlaylistIds = orderedPlaylists.map(playlistId);
  const selection = useMultiSelection(orderedPlaylistIds, 'playlists');
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  function getActionPlaylists(clickedId: Id): Playlist[] {
    const byId = new Map(orderedPlaylists.map((playlist) => [playlist.id, playlist]));
    return selection.actionIds(clickedId).flatMap((id) => {
      const playlist = byId.get(id);
      return playlist ? [playlist] : [];
    });
  }

  function retainSelection(ids: readonly Id[]) {
    const visible = [...ids].sort((left, right) => orderedPlaylistIds.indexOf(left) - orderedPlaylistIds.indexOf(right));
    selection.clearSelection();
    visible.forEach((id, index) => selection.select(id, index === 0 ? {} : { ctrlKey: true }));
  }

  async function handleDeletePlaylists(playlists: readonly Playlist[]) {
    const ok = await confirm({
      title: `Delete ${playlists.length} playlists?`,
      description: 'All entries and separators in these playlists will be removed. This action cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;

    for (let index = 0; index < playlists.length; index += 1) {
      try {
        await deletePlaylist(playlists[index].id);
      } catch {
        retainSelection(playlists.slice(index).map((playlist) => playlist.id));
        return;
      }
    }
    selection.clearSelection();
  }

  async function handleMovePlaylists(playlists: readonly Playlist[], direction: 'up' | 'down') {
    const ordered = direction === 'up' ? [...playlists] : [...playlists].reverse();
    for (let index = 0; index < ordered.length; index += 1) {
      try {
        await movePlaylist(ordered[index].id, direction);
      } catch {
        retainSelection(ordered.slice(index).map((playlist) => playlist.id));
        return;
      }
    }
  }

  const commitReorder = useCallback(
    // Deliberately unguarded: useSortableOrder needs the rejection to know it
    // must put the playlist back where it came from.
    (change: SortableOrderCommit) => commitSelectedReorder(change, reorderPlaylist),
    [reorderPlaylist],
  );

  const { items: playlists, dnd } = useSortableOrder({
    items: orderedPlaylists,
    getId: playlistId,
    commit: commitReorder,
    selectedIds: selection.selectedIds,
  });

  function handleCreate() { void createPlaylist(); }

  if (!snapshot) return null;

  return (
    <LumaCastPanel.Root className='h-full'>
      <SplitPanel.Panel splitId="playlist-panel" orientation="vertical" className="flex-1">
        <SplitPanel.Segment id="playlist-list" defaultSize={200} minSize={120}>
          <Panel>
            <Panel.Header>
              <Panel.HeaderTitle>Playlists</Panel.HeaderTitle>
              <Panel.HeaderActions>
                <ReacstButton.Icon onClick={handleCreate} aria-label="New playlist" title="New playlist">
                  <Plus />
                </ReacstButton.Icon>
              </Panel.HeaderActions>
            </Panel.Header>
            <Panel.Body>
              <ScrollArea.Root>
                <ScrollArea.Viewport role="list" aria-label="Playlists" data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
                  <SortableList.Root {...dnd}>
                    {playlists.map((playlist) => (
                      <PlaylistRow
                        key={playlist.id}
                        playlist={playlist}
                        isMultiSelected={selection.selectedIds.has(playlist.id)}
                        actionPlaylists={getActionPlaylists(playlist.id)}
                        onSelectionClick={(id, event) => {
                          selection.select(id, event);
                          return event.shiftKey || event.metaKey || event.ctrlKey;
                        }}
                        onDeletePlaylists={handleDeletePlaylists}
                        onMovePlaylists={handleMovePlaylists}
                      />
                    ))}
                  </SortableList.Root>
                </ScrollArea.Viewport>
                <ScrollArea.Scrollbar>
                  <ScrollArea.Thumb />
                </ScrollArea.Scrollbar>
              </ScrollArea.Root>
            </Panel.Body>
          </Panel>
        </SplitPanel.Segment>
        <SplitPanel.Segment id="playlist-rows" fill defaultSize={320} minSize={180}>
          <PlaylistRowsBrowser />
        </SplitPanel.Segment>
      </SplitPanel.Panel>
    </LumaCastPanel.Root>
  );
}
