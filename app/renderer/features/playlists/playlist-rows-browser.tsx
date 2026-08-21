import { Plus } from 'lucide-react';
import { ReacstButton } from '../../components/controls/button';
import { EmptyState } from '../../components/display/empty-state';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Label } from '@renderer/components/display/text';
import { ScrollArea } from '../../components/layout/scroll-area';
import { useNavigation } from '../../contexts/navigation-context';
import { PlaylistRowList } from './playlist-row-list';

// #219 item-model refactor decision D5/D9: replaces the accordion-of-groups
// browser — a playlist's rows are already flat and ordered, so this renders
// them straight through: a separator row is a plain non-collapsing divider,
// never a container, and sits as a sibling of the item rows around it.
export function PlaylistRowsBrowser() {
  const { currentPlaylistId, currentPlaylistRows, createSeparator } = useNavigation();

  function handleNewSeparator() { void createSeparator(); }

  if (!currentPlaylistId) {
    return <EmptyState.Root><EmptyState.Title>Select a playlist</EmptyState.Title></EmptyState.Root>;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <LumaCastPanel.Group>
        <LumaCastPanel.GroupTitle className='border-t'>
          <Label.xs className='mr-auto'>Items</Label.xs>
          <ReacstButton.Icon onClick={handleNewSeparator} aria-label="New separator" title="New separator">
            <Plus />
          </ReacstButton.Icon>
        </LumaCastPanel.GroupTitle>
      </LumaCastPanel.Group>

      <LumaCastPanel.Group className="flex-1 min-h-0">
        <ScrollArea.Root>
          <ScrollArea.Viewport>
            <PlaylistRowList rows={currentPlaylistRows} playlistId={currentPlaylistId} />
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar>
            <ScrollArea.Thumb />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </LumaCastPanel.Group>
    </div>
  );
}
