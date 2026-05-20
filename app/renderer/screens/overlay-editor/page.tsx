import { type MouseEvent as ReactMouseEvent } from 'react';
import { LAYER_PREVIEW_SLIDE, overlayToLayerElements } from '@core/presentation-layers';
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
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useOverlayEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
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
                    <ScrollArea.Root scrollPadding={8}>
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

function OverlayListItem(props: {
  overlay: ReturnType<typeof useOverlayEditorScreen>['state']['overlays'][number];
  index: number;
  isActive: boolean;
}) {
  return (
    <ContextMenu.Root>
      <OverlayListItemBody {...props} />
    </ContextMenu.Root>
  );
}

function OverlayListItemBody({
  overlay,
  index,
  isActive,
}: {
  overlay: ReturnType<typeof useOverlayEditorScreen>['state']['overlays'][number];
  index: number;
  isActive: boolean;
}) {
  const { actions } = useOverlayEditorScreen();
  const { duplicateOverlay, deleteOverlay, requestNameFocus } = useOverlayEditor();
  const confirm = useConfirm();
  const scene = buildRenderScene({ width: LAYER_PREVIEW_SLIDE.width, height: LAYER_PREVIEW_SLIDE.height, background: overlay.background ?? null }, overlayToLayerElements(overlay));
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive);
  const { ref: triggerRef, onContextMenu: triggerContextMenu, ...triggerHandlers } = useContextMenuTrigger();

  function handleSelect() {
    actions.selectOverlay(overlay.id);
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!isActive) actions.selectOverlay(overlay.id);
    triggerContextMenu(event);
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${overlay.name}"?`,
      description: 'This overlay will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteOverlay(overlay.id);
  }

  return (
    <>
      <Thumbnail.Tile
        {...triggerHandlers}
        ref={(node) => {
          activeRef.current = node;
          triggerRef(node);
        }}
        onContextMenu={handleContextMenu}
        onClick={handleSelect}
        selected={isActive}
      >
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
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => requestNameFocus(overlay.id)}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => duplicateOverlay(overlay.id)}>Duplicate</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
