import { LumaCastPanel } from '@renderer/components/layout/panel';
import { StagePanel } from '../../features/canvas/stage-panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { EmptyState, DropdownMenu, Panel } from '@lumacast/ui';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { Plus } from 'lucide-react';
import { OverlayEditorInspectorPanel } from './inspector-panel';
import { OverlayEditorLayersPanel } from './layers-panel';
import { useOverlayEditorScreen } from './screen-context';
import { OverlayList } from './overlay-list';

export function OverlayEditorScreenContent() {
  const { state, actions } = useOverlayEditorScreen();

  return (
    <SplitPanel.Panel splitId="editor-main" orientation="horizontal" className="h-full" data-ui-region="editor-layout">
      <SplitPanel.Segment id="editor-left" defaultSize={280} minSize={140} collapsible>
        <LumaCastPanel.Root className="h-full border-r border-secondary">
          <SplitPanel.Panel splitId="overlay-list-panel" orientation="vertical" className="h-full">
            <SplitPanel.Segment id="overlay-list" defaultSize={440} minSize={180}>
              <Panel className="min-h-0">
                <Panel.Header>
                  <Panel.HeaderTitle>Overlays</Panel.HeaderTitle>
                  <Panel.HeaderActions>
                    <DropdownMenu
                      align="end"
                      trigger={(
                        <button type="button" aria-label="Add" className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary [&>svg]:size-4">
                          <Plus />
                        </button>
                      )}
                      entries={[
                        { id: 'new-overlay', label: 'New overlay', onSelect: () => { void actions.createOverlay(); } },
                      ]}
                    />
                  </Panel.HeaderActions>
                </Panel.Header>
                <Panel.Body className="flex flex-col items-start scrollbar-hidden">
                  {state.overlays.length === 0 ? (
                    <EmptyState.Root>
                      <EmptyState.Title>No overlays yet</EmptyState.Title>
                      <EmptyState.Description>Click the + button to create your first overlay.</EmptyState.Description>
                    </EmptyState.Root>
                  ) : (
                    <ScrollArea.Root scrollPadding={8}>
                      <ScrollArea.Viewport className="p-2">
                        <OverlayList />
                      </ScrollArea.Viewport>
                      <ScrollArea.Scrollbar>
                        <ScrollArea.Thumb />
                      </ScrollArea.Scrollbar>
                    </ScrollArea.Root>
                  )}
                </Panel.Body>
              </Panel>
            </SplitPanel.Segment>
            <SplitPanel.Segment id="overlay-objects" fill defaultSize={220} minSize={160}>
              <Panel className="min-h-0">
                <Panel.Header className="border-t">
                  <Panel.HeaderTitle>Layers</Panel.HeaderTitle>
                </Panel.Header>
                <Panel.Body padded className="scrollbar-hidden">
                  <OverlayEditorLayersPanel />
                </Panel.Body>
              </Panel>
            </SplitPanel.Segment>
          </SplitPanel.Panel>
        </LumaCastPanel.Root>
      </SplitPanel.Segment>
      <SplitPanel.Segment id="editor-center" fill defaultSize={840} minSize={360}>
        <StagePanel />
      </SplitPanel.Segment>
      <SplitPanel.Segment id="editor-right" defaultSize={320} minSize={140} collapsible>
        <OverlayEditorInspectorPanel />
      </SplitPanel.Segment>
    </SplitPanel.Panel>
  );
}
