import { useCallback, useEffect, useRef } from 'react';
import { List, Plus } from 'lucide-react';
import type { Playlist } from '@lumacast/composition';
import { useNavigation } from '@renderer/contexts/navigation-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useCast } from '@renderer/contexts/app-context';
import { ReacstButton } from '@renderer/components/controls/button';
import { Label } from '@renderer/components/display/text';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { RenameField, RenameFieldHandle } from '@renderer/components/form/rename-field';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { SortableList, useSortableItem, useSortableOrder } from '@renderer/components/layout/sortable-list';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { PlaylistRowsBrowser } from './playlist-rows-browser';
import { usePlaylistPanelManagement } from './use-playlist-panel-management';

// #219 item-model refactor decision D4: playlists are global — there is no
// library hierarchy above them any more, so this panel is just "the list of
// playlists" plus the rows of whichever one is selected. No back-to-libraries
// chevron, no library name header.
const playlistId = (playlist: Playlist) => playlist.id;

export function PlaylistPanels() {
  const { createPlaylist, reorderPlaylist } = useNavigation();
  const { snapshot } = useCast();
  const { playlists: orderedPlaylists } = useProjectContent();

  const commitReorder = useCallback(
    // Deliberately unguarded: useSortableOrder needs the rejection to know it
    // must put the playlist back where it came from.
    ({ id, toIndex }: { id: string; toIndex: number }) => reorderPlaylist(id, toIndex),
    [reorderPlaylist],
  );

  const { items: playlists, dnd } = useSortableOrder({
    items: orderedPlaylists,
    getId: playlistId,
    commit: commitReorder,
  });

  function handleCreate() { void createPlaylist(); }

  if (!snapshot) return null;

  return (
    <LumaCastPanel.Root className='h-full'>
      <SplitPanel.Panel splitId="playlist-panel" orientation="vertical" className="flex-1">
        <SplitPanel.Segment id="playlist-list" defaultSize={200} minSize={120}>
          <LumaCastPanel.Group>
            <LumaCastPanel.GroupTitle>
              <Label.xs className='mr-auto'>Playlists</Label.xs>
              <ReacstButton.Icon onClick={handleCreate} aria-label="New playlist" title="New playlist">
                <Plus />
              </ReacstButton.Icon>
            </LumaCastPanel.GroupTitle>
          </LumaCastPanel.Group>

          <LumaCastPanel.GroupContent className="py-1.5 space-y-1">
            <ScrollArea.Root>
              <ScrollArea.Viewport role="list" aria-label="Playlists">
                <SortableList.Root {...dnd}>
                  {playlists.map((playlist) => <PlaylistRow key={playlist.id} playlist={playlist} />)}
                </SortableList.Root>
              </ScrollArea.Viewport>
              <ScrollArea.Scrollbar>
                <ScrollArea.Thumb />
              </ScrollArea.Scrollbar>
            </ScrollArea.Root>
          </LumaCastPanel.GroupContent>
        </SplitPanel.Segment>
        <SplitPanel.Segment id="playlist-rows" defaultSize={320} minSize={180}>
          <PlaylistRowsBrowser />
        </SplitPanel.Segment>
      </SplitPanel.Panel>
    </LumaCastPanel.Root>
  );
}

function PlaylistRow({ playlist }: { playlist: Playlist }) {
  return (
    <ContextMenu.Root>
      <PlaylistRowBody playlist={playlist} />
    </ContextMenu.Root>
  );
}

function PlaylistRowBody({ playlist }: { playlist: Playlist }) {
  const { currentPlaylistId, setCurrentPlaylistId, renamePlaylist, recentlyCreatedId, clearRecentlyCreated } = useNavigation();
  const { deletePlaylist, movePlaylist } = usePlaylistPanelManagement();
  const confirm = useConfirm();
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();
  const { containerRef, containerStyle, handleProps } = useSortableItem(playlist.id);

  const isSelected = playlist.id === currentPlaylistId;
  const isEditing = playlist.id === recentlyCreatedId;

  useEffect(() => {
    if (isEditing) renameRef.current?.startEditing();
  }, [isEditing]);

  function handleRename(name: string) {
    // renamePlaylist rejects when the playlist no longer exists (#214), which
    // a rename field commit can race with a concurrent delete. mutatePatch has
    // already reported the failure, so absorb the rethrow here.
    void renamePlaylist(playlist.id, name).catch(() => undefined);
    clearRecentlyCreated();
  }

  function handleSelect() { setCurrentPlaylistId(playlist.id); }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${playlist.name}"?`,
      description: 'All entries and separators in this playlist will be removed. This action cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deletePlaylist(playlist.id);
  }

  return (
    <>
      <div ref={containerRef} style={containerStyle}>
        <LumaCastPanel.MenuItem
          {...triggerHandlers}
          {...handleProps}
          ref={triggerRef}
          active={isSelected}
          onClick={handleSelect}
          className="cursor-grab focus-visible:ring-2 focus-visible:ring-brand active:cursor-grabbing"
        >
          <List className='size-4' />
          <RenameField ref={renameRef} value={playlist.name} onValueChange={handleRename} className="label-xs" />
        </LumaCastPanel.MenuItem>
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => { void movePlaylist(playlist.id, 'up'); }}>Move up</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { void movePlaylist(playlist.id, 'down'); }}>Move down</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
