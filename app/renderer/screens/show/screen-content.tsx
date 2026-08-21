import { ResourceDrawer } from '../../features/workbench/resource-drawer';
import { ProgramPanel } from '../../features/playback/program-panel';
import { DeckBrowserToolbar } from '../../features/items/deck-browser-toolbar';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { PlaylistPanels } from '@renderer/features/playlists/playlist-panels';
import { useShowScreen } from './screen-context';
import { ShowBrowserContent } from './browser-content';

export function ShowScreenContent() {
  const { state: { browser } } = useShowScreen();

  return (
    <SplitPanel.Panel splitId="show-main" orientation="horizontal" className="h-full">
      <SplitPanel.Segment id="show-left" defaultSize={300} minSize={140} collapsible>
        <PlaylistPanels />
      </SplitPanel.Segment>
      <SplitPanel.Segment id="show-center" defaultSize={840} minSize={360}>
        <SplitPanel.Panel splitId="show-center" orientation="vertical" className="h-full">
          <SplitPanel.Segment id="show-middle" defaultSize={600} minSize={360} className="flex flex-col">
            <DeckBrowserToolbar items={browser.items} headerVariant={browser.headerVariant} />
            <div className="min-h-0 flex-1">
              <ShowBrowserContent variant={browser.contentVariant} items={browser.items} />
            </div>
          </SplitPanel.Segment>
          <SplitPanel.Segment id="show-bottom" defaultSize={260} minSize={96} collapsible>
            <ResourceDrawer.Root>
              <ResourceDrawer.Header />
              <ResourceDrawer.Body />
            </ResourceDrawer.Root>
          </SplitPanel.Segment>
        </SplitPanel.Panel>
      </SplitPanel.Segment>
      <SplitPanel.Segment id="show-right" defaultSize={320} minSize={140} maxSize={360} collapsible>
        <ProgramPanel />
      </SplitPanel.Segment>
    </SplitPanel.Panel>
  );
}
