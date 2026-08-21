import { useCallback } from 'react';
import { Plus } from 'lucide-react';
import type { Playlist } from '@lumacast/composition';
import { useNavigation } from '@renderer/contexts/navigation-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { useCast } from '@renderer/contexts/app-context';
import { ReacstButton } from '@renderer/components/controls/button';
import { Label } from '@renderer/components/display/text';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { SortableList, useSortableOrder } from '@renderer/components/layout/sortable-list';
import { PlaylistRowsBrowser } from './playlist-rows-browser';
import { PlaylistRow } from './playlist-row';

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
