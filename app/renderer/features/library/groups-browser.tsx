import { Plus } from 'lucide-react';
import type { PlaylistTree } from '@core/types';
import { ReacstButton } from '@renderer/components/controls/button';
import { ScrollArea } from '../../components/layout/scroll-area';
import { useNavigation } from '../../contexts/navigation-context';
import { useLibraryBrowser } from './library-browser-context';
import { useLibraryPanelState } from './library-panel-context';
import { PlaylistGroup } from './playlist-group';
import { Label } from '@renderer/components/display/text';
import { Accordion } from '@renderer/components/display/accordion';
import { EmptyState } from '../../components/display/empty-state';
import { LumaCastPanel } from '@renderer/components/layout/panel';

type GroupList = PlaylistTree['groups'];

const EMPTY_GROUPS: GroupList = [];

export function GroupsBrowser() {
  const { createGroup } = useNavigation();
  const { libraryPanelView, expandedGroupIds, setExpandedGroupIds } = useLibraryPanelState();
  const { state } = useLibraryBrowser();

  const rawGroups = state.selectedTree?.groups ?? EMPTY_GROUPS;

  if (libraryPanelView !== 'playlist') return null;
  if (!state.selectedTree) {
    return <EmptyState.Root><EmptyState.Title>Select a playlist</EmptyState.Title></EmptyState.Root>;
  }

  function handleNewGroup() { void createGroup(); }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <LumaCastPanel.Group>
        <LumaCastPanel.GroupTitle className='border-t'>
          <Label.xs className='mr-auto'>Groups</Label.xs>
          <ReacstButton.Icon onClick={handleNewGroup} aria-label="New group" title="New group">
            <Plus />
          </ReacstButton.Icon>
        </LumaCastPanel.GroupTitle>
      </LumaCastPanel.Group>

      <LumaCastPanel.Group className="flex-1 min-h-0">
        <ScrollArea.Root>
          <ScrollArea.Viewport>
            <Accordion type='multiple' value={expandedGroupIds} onValueChange={handleGroupValueChange}>
              {rawGroups.map((group, index) => (
                <PlaylistGroup
                  key={group.group.id}
                  group={group}
                  index={index}
                  totalGroups={rawGroups.length}
                />
              ))}
            </Accordion>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar>
            <ScrollArea.Thumb />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </LumaCastPanel.Group>
    </div>
  );

  function handleGroupValueChange(value: string | string[]) {
    setExpandedGroupIds(Array.isArray(value) ? value : value ? [value] : []);
  }
}
