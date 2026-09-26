import { useEffect, useRef } from 'react';
import { List } from 'lucide-react';
import type { Playlist } from '@lumacast/composition';
import { useNavigation } from '@renderer/contexts/navigation-context';
import { usePlaylistPanelManagement } from './use-playlist-panel-management';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { RenameField, type RenameFieldHandle } from '@renderer/components/form/rename-field';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useSortableItem } from '@renderer/components/layout/sortable-list';

export function PlaylistRowBody({ playlist }: { playlist: Playlist }) {
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
