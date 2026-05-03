import { ResourceDrawer } from '../../features/workbench/resource-drawer';
import { ContinuousSlideBrowser } from '../../features/deck/continuous-slide-browser';
import { ProgramPanel } from '../../features/playback/program-panel';
import { DeckBrowserToolbar } from '../../features/deck/deck-browser-toolbar';
import { SlideBrowserContent } from '../../features/deck/slide-browser-content';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { LibrariesPanel } from '@renderer/features/library/libraries-panel';
import { PlaylistPanels } from '@renderer/features/library/playlist-panels';
import { Logo } from '@renderer/components/assets';
import { ShowScreenProvider, useShowScreen } from './screen-context';

export function ShowScreen() {
  return (
    <ShowScreenProvider>
      <ShowScreenContent />
    </ShowScreenProvider>
  );
}

function ShowScreenContent() {
  const { state: { browser } } = useShowScreen();

  return (
    <SplitPanel.Panel splitId="show-main" orientation="horizontal" className="h-full">
      <SplitPanel.Segment id="show-left" defaultSize={300} minSize={140} collapsible>
        <LibrariesPanel />
        <PlaylistPanels />
      </SplitPanel.Segment>
      <SplitPanel.Segment id="show-center" defaultSize={840} minSize={360}>
        <SplitPanel.Panel splitId="show-center" orientation="vertical" className="h-full">
          <SplitPanel.Segment id="show-middle" defaultSize={600} minSize={360}>
            <DeckBrowserToolbar items={browser.items} headerVariant={browser.headerVariant} />
            {browser.contentVariant === 'empty' && (
              <div className="flex h-full min-h-0 items-center justify-center p-2">
                <Logo className="size-60 opacity-10" />
              </div>
            )}
            <SlideBrowserContent variant={browser.contentVariant} />
            <ContinuousSlideBrowser variant={browser.contentVariant} items={browser.items} />
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
