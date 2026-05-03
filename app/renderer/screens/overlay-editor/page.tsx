import { overlayToLayerElements } from '@core/presentation-layers';
import { Plus } from 'lucide-react';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Thumbnail } from '../../components/display/thumbnail';
import { SceneFrame } from '../../components/display/scene-frame';
import { Dropdown } from '../../components/form/dropdown';
import { buildRenderScene } from '../../features/canvas/build-render-scene';
import { SceneStage } from '../../features/canvas/scene-stage';
import { StagePanel } from '../../features/canvas/stage-panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { Label } from '@renderer/components/display/text';
import { EmptyState } from '@renderer/components/display/empty-state';
import { ScrollArea, useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { OverlayEditorInspectorPanel } from './inspector-panel';
import { OverlayEditorLayersPanel } from './layers-panel';
import { OverlayEditorScreenProvider, useOverlayEditorScreen } from './screen-context';

export function OverlayEditorScreen() {
  return (
    <OverlayEditorScreenProvider>
      <OverlayEditorScreenContent />
    </OverlayEditorScreenProvider>
  );
}

function OverlayEditorScreenContent() {
  const { state, actions } = useOverlayEditorScreen();

  return (
    <SplitPanel.Panel splitId="editor-main" orientation="horizontal" className="h-full" data-ui-region="editor-layout">
      <SplitPanel.Segment id="editor-left" defaultSize={280} minSize={140} collapsible>
        <LumaCastPanel.Root className="h-full border-r border-secondary">
          <SplitPanel.Panel splitId="overlay-list-panel" orientation="vertical" className="h-full">
            <SplitPanel.Segment id="overlay-list" defaultSize={440} minSize={180}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle>
                  <Label.sm className="mr-auto">Overlays</Label.sm>
                  <Dropdown>
                    <Dropdown.Trigger
                      aria-label="Add"
                      className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary [&>svg]:size-4"
                    >
                      <Plus />
                    </Dropdown.Trigger>
                    <Dropdown.Panel placement="bottom-end">
                      <Dropdown.Item onClick={() => { void actions.createOverlay(); }}>
                        New overlay
                      </Dropdown.Item>
                    </Dropdown.Panel>
                  </Dropdown>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content>
                  {state.overlays.length === 0 ? (
                    <EmptyState.Root>
                      <EmptyState.Title>No overlays yet</EmptyState.Title>
                      <EmptyState.Description>Click the + button to create your first overlay.</EmptyState.Description>
                    </EmptyState.Root>
                  ) : (
                    <ScrollArea.Root>
                      <ScrollArea.Viewport className="p-2">
                        <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label="Library overlays">
                          {state.overlays.map((overlay, index) => (
                            <OverlayListItem key={overlay.id} overlay={overlay} index={index} isActive={state.currentOverlayId === overlay.id} />
                          ))}
                        </div>
                      </ScrollArea.Viewport>
                      <ScrollArea.Scrollbar>
                        <ScrollArea.Thumb />
                      </ScrollArea.Scrollbar>
                    </ScrollArea.Root>
                  )}
                </LumaCastPanel.Content>
              </LumaCastPanel.Group>
            </SplitPanel.Segment>
            <SplitPanel.Segment id="overlay-objects" defaultSize={220} minSize={160}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle className="border-t">
                  <Label.xs className="mr-auto">Layers</Label.xs>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content className="overflow-y-auto p-2">
                  <OverlayEditorLayersPanel />
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
        <OverlayEditorInspectorPanel />
      </SplitPanel.Segment>
    </SplitPanel.Panel>
  );
}

function OverlayListItem({
  overlay,
  index,
  isActive,
}: {
  overlay: ReturnType<typeof useOverlayEditorScreen>['state']['overlays'][number];
  index: number;
  isActive: boolean;
}) {
  const { actions } = useOverlayEditorScreen();
  const scene = buildRenderScene(null, overlayToLayerElements(overlay));

  function handleSelect() {
    actions.selectOverlay(overlay.id);
  }

  return (
    <ActiveOverlayTile isActive={isActive} onClick={handleSelect} selected={isActive}>
      <Thumbnail.Body>
        <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
          <SceneStage scene={scene} surface="list" className="absolute inset-0 pointer-events-none" />
        </SceneFrame>
      </Thumbnail.Body>
      <Thumbnail.Caption>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
          <span className="min-w-0 truncate text-sm text-tertiary">{overlay.name}</span>
        </div>
      </Thumbnail.Caption>
    </ActiveOverlayTile>
  );
}

function ActiveOverlayTile({ isActive, ...props }: React.ComponentProps<typeof Thumbnail.Tile> & { isActive: boolean }) {
  const ref = useScrollAreaActiveItem(isActive);
  return <Thumbnail.Tile ref={ref} {...props} />;
}
