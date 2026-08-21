import { LumaCastPanel } from '@renderer/components/layout/panel';
import { StagePanel } from '../../features/canvas/stage-panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { Label } from '@renderer/components/display/text';
import { EmptyState } from '@renderer/components/display/empty-state';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { Dropdown } from '../../components/form/dropdown';
import { Plus } from 'lucide-react';
import { StageEditorInspectorPanel } from './inspector-panel';
import { StageEditorLayersPanel } from './layers-panel';
import { useStageEditorScreen } from './screen-context';
import { StageList } from './stage-list';

export function StageEditorScreenContent() {
  const { state, actions } = useStageEditorScreen();

  return (
    <SplitPanel.Panel splitId="editor-main" orientation="horizontal" className="h-full" data-ui-region="editor-layout">
      <SplitPanel.Segment id="editor-left" defaultSize={280} minSize={140} collapsible>
        <LumaCastPanel.Root className="h-full border-r border-secondary">
          <SplitPanel.Panel splitId="stage-list-panel" orientation="vertical" className="h-full">
            <SplitPanel.Segment id="stage-list" defaultSize={440} minSize={180}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle>
                  <Label.sm className="mr-auto">Stages</Label.sm>
                  <Dropdown>
                    <Dropdown.Trigger
                      aria-label="Add"
                      className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary [&>svg]:size-4"
                    >
                      <Plus />
                    </Dropdown.Trigger>
                    <Dropdown.Panel placement="bottom-end">
                      <Dropdown.Item onClick={() => { void actions.createStage(); }}>
                        New stage
                      </Dropdown.Item>
                    </Dropdown.Panel>
                  </Dropdown>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content>
                  {state.stages.length === 0 ? (
                    <EmptyState.Root>
                      <EmptyState.Title>No stages yet</EmptyState.Title>
                      <EmptyState.Description>Click the + button to create your first stage layout.</EmptyState.Description>
                    </EmptyState.Root>
                  ) : (
                    <ScrollArea.Root scrollPadding={8}>
                      <ScrollArea.Viewport className="p-2">
                        <StageList />
                      </ScrollArea.Viewport>
                      <ScrollArea.Scrollbar>
                        <ScrollArea.Thumb />
                      </ScrollArea.Scrollbar>
                    </ScrollArea.Root>
                  )}
                </LumaCastPanel.Content>
              </LumaCastPanel.Group>
            </SplitPanel.Segment>
            <SplitPanel.Segment id="stage-objects" defaultSize={220} minSize={160}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle className="border-t">
                  <Label.xs className="mr-auto">Layers</Label.xs>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content className="overflow-y-auto p-2">
                  <StageEditorLayersPanel />
                </LumaCastPanel.Content>
              </LumaCastPanel.Group>
            </SplitPanel.Segment>
          </SplitPanel.Panel>
        </LumaCastPanel.Root>
      </SplitPanel.Segment>
      <SplitPanel.Segment id="editor-center" defaultSize={840} minSize={360}>
        <StagePanel />
      </SplitPanel.Segment>
      <SplitPanel.Segment id="editor-right" defaultSize={320} minSize={140} collapsible>
        <StageEditorInspectorPanel />
      </SplitPanel.Segment>
    </SplitPanel.Panel>
  );
}
