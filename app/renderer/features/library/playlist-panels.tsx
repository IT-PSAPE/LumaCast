import { ChevronLeft, List, Plus } from 'lucide-react';
import { useNavigation } from '@renderer/contexts/navigation-context';
import { ReacstButton } from '@renderer/components/controls/button';
import { Label } from '@renderer/components/display/text';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { useLibraryBrowser } from './library-browser-context';
import { SegmentsBrowser } from './segments-browser';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { PlaylistTree } from '@core/types';
import { RenameField, RenameFieldHandle } from '@renderer/components/form/rename-field';
import { useEffect, useRef } from 'react';
import { useLibraryPanelState } from './library-panel-context';

export function PlaylistPanels() {
  const { currentLibraryBundle, createPlaylist } = useNavigation();
  const { actions } = useLibraryBrowser();
  const { libraryPanelView } = useLibraryPanelState();

  function handleCreate() { void createPlaylist(); }

  if (libraryPanelView !== 'playlist' || !currentLibraryBundle) return null;

  const playlists = currentLibraryBundle.playlists;

  return (
    <LumaCastPanel.Root className='h-full'>
      <LumaCastPanel.Group>
        <LumaCastPanel.GroupTitle>
          <ReacstButton.Icon label="Back to libraries" onClick={actions.setLibrariesView}>
            <ChevronLeft />
          </ReacstButton.Icon>
          <Label.sm className="mr-auto">{currentLibraryBundle.library.name}</Label.sm>
        </LumaCastPanel.GroupTitle>
        <SplitPanel.Panel splitId="library-panel" orientation="vertical" className="flex-1">
          <SplitPanel.Segment id="library-playlists" defaultSize={200} minSize={120}>
            <LumaCastPanel.Group>
              <LumaCastPanel.GroupTitle>
                <Label.xs className='mr-auto'>Playlists</Label.xs>
                <ReacstButton.Icon onClick={handleCreate}>
                  <Plus />
                </ReacstButton.Icon>
              </LumaCastPanel.GroupTitle>
            </LumaCastPanel.Group>

            <LumaCastPanel.GroupContent className="py-1.5 space-y-1">
              <ScrollArea.Root>
                <ScrollArea.Viewport role="list" aria-label="Playlists">
                  {playlists.map((tree) => <PlaylistRow key={tree.playlist.id} tree={tree} />)}
                </ScrollArea.Viewport>
                <ScrollArea.Scrollbar>
                  <ScrollArea.Thumb />
                </ScrollArea.Scrollbar>
              </ScrollArea.Root>
            </LumaCastPanel.GroupContent>
          </SplitPanel.Segment>
          <SplitPanel.Segment id="library-segments" defaultSize={320} minSize={180}>
            <SegmentsBrowser />
          </SplitPanel.Segment>
        </SplitPanel.Panel>
      </LumaCastPanel.Group>
    </LumaCastPanel.Root>
  );
}

function PlaylistRow({ tree }: { tree: PlaylistTree }) {
  const { currentPlaylistId, setCurrentPlaylistId, renamePlaylist, recentlyCreatedId, clearRecentlyCreated } = useNavigation();
  const renameRef = useRef<RenameFieldHandle>(null);

  const isSelected = tree.playlist.id === currentPlaylistId;
  const isEditing = tree.playlist.id === recentlyCreatedId;

  useEffect(() => {
    if (isEditing) renameRef.current?.startEditing();
  }, [isEditing]);

  function handleRename(name: string) {
    void renamePlaylist(tree.playlist.id, name);
    clearRecentlyCreated();
  }

  function handleSelect() { setCurrentPlaylistId(tree.playlist.id); }

  return (
    <LumaCastPanel.MenuItem active={isSelected} onClick={handleSelect}>
      <List className='size-4' />
      <RenameField ref={renameRef} value={tree.playlist.name} onValueChange={handleRename} className="label-xs" />
    </LumaCastPanel.MenuItem>
  );
}
