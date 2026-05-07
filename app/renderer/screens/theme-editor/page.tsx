import { useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import type { Theme } from '@core/types';
import { Layers, Music, Plus, Presentation } from 'lucide-react';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { SceneFrame } from '../../components/display/scene-frame';
import { Thumbnail } from '../../components/display/thumbnail';
import { Dropdown } from '../../components/form/dropdown';
import { buildRenderScene } from '../../features/canvas/build-render-scene';
import { StagePanel } from '../../features/canvas/stage-panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { EmptyState } from '@renderer/components/display/empty-state';
import { Label } from '@renderer/components/display/text';
import { ScrollArea, useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useThemeEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { ThemeEditorInspectorPanel } from './inspector-panel';
import { ThemeEditorLayersPanel } from './layers-panel';
import { ThemeEditorScreenProvider, useThemeEditorScreen } from './screen-context';

export function ThemeEditorScreen() {
  return (
    <ThemeEditorScreenProvider>
      <ThemeEditorScreenContent />
    </ThemeEditorScreenProvider>
  );
}

function ThemeEditorScreenContent() {
  const { state, actions } = useThemeEditorScreen();

  return (
    <SplitPanel.Panel splitId="editor-main" orientation="horizontal" className="h-full" data-ui-region="editor-layout">
      <SplitPanel.Segment id="editor-left" defaultSize={280} minSize={140} collapsible>
        <LumaCastPanel.Root className="h-full border-r border-secondary">
          <SplitPanel.Panel splitId="theme-list-panel" orientation="vertical" className="h-full">
            <SplitPanel.Segment id="theme-list" defaultSize={440} minSize={180}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle>
                  <Label.sm className="mr-auto">Themes</Label.sm>
                  <Dropdown>
                    <Dropdown.Trigger
                      aria-label="Add"
                      className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary [&>svg]:size-4"
                    >
                      <Plus />
                    </Dropdown.Trigger>
                    <Dropdown.Panel placement="bottom-end">
                      <Dropdown.Item onClick={() => actions.createTheme('slides')}>
                        New presentation theme
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => actions.createTheme('lyrics')}>
                        New lyric theme
                      </Dropdown.Item>
                    </Dropdown.Panel>
                  </Dropdown>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content>
                  {state.themes.length === 0 ? (
                    <EmptyState.Root>
                      <EmptyState.Title>No themes yet</EmptyState.Title>
                      <EmptyState.Description>Click the + button to create your first theme.</EmptyState.Description>
                    </EmptyState.Root>
                  ) : (
                    <ScrollArea.Root scrollPadding={8}>
                      <ScrollArea.Viewport className="p-2">
                        <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label="Themes">
                          {state.themes.map((theme, index) => (
                            <ThemeListItem key={theme.id} theme={theme} index={index} isActive={theme.id === state.currentThemeId} />
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
            <SplitPanel.Segment id="theme-objects" defaultSize={220} minSize={160}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle className="border-t">
                  <Label.xs className="mr-auto">Layers</Label.xs>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content className="overflow-y-auto p-2">
                  <ThemeEditorLayersPanel />
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
        <ThemeEditorInspectorPanel />
      </SplitPanel.Segment>
    </SplitPanel.Panel>
  );
}

function ThemeListItem(props: {
  theme: ReturnType<typeof useThemeEditorScreen>['state']['themes'][number];
  index: number;
  isActive: boolean;
}) {
  return (
    <ContextMenu.Root>
      <ThemeListItemBody {...props} />
    </ContextMenu.Root>
  );
}

function ThemeListItemBody({
  theme,
  index,
  isActive,
}: {
  theme: ReturnType<typeof useThemeEditorScreen>['state']['themes'][number];
  index: number;
  isActive: boolean;
}) {
  const { actions } = useThemeEditorScreen();
  const { duplicateTheme, deleteTheme, requestNameFocus } = useThemeEditor();
  const confirm = useConfirm();
  const scene = useMemo(() => buildRenderScene(null, theme.elements), [theme.elements]);
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive);
  const { ref: triggerRef, onContextMenu: triggerContextMenu, ...triggerHandlers } = useContextMenuTrigger();

  function handleSelect() {
    actions.selectTheme(theme.id);
  }

  function handleCaptionDoubleClick(event: React.MouseEvent) {
    event.stopPropagation();
    actions.requestThemeNameFocus(theme.id);
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!isActive) actions.selectTheme(theme.id);
    triggerContextMenu(event);
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${theme.name}"?`,
      description: 'This theme will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) deleteTheme(theme.id);
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
            <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
          </SceneFrame>
        </Thumbnail.Body>
        <Thumbnail.Caption>
          <div className="flex items-center gap-2" onDoubleClick={handleCaptionDoubleClick}>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
            <ThemeKindIcon kind={theme.kind} />
            <span className="min-w-0 truncate text-sm text-tertiary">{theme.name}</span>
          </div>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => requestNameFocus(theme.id)}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => duplicateTheme(theme.id)}>Duplicate</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

function ThemeKindIcon({ kind }: { kind: Theme['kind'] }) {
  if (kind === 'lyrics') {
    return <Music size={14} strokeWidth={1.75} className="shrink-0 text-tertiary" />;
  }
  if (kind === 'overlays') {
    return <Layers size={14} strokeWidth={1.75} className="shrink-0 text-tertiary" />;
  }
  return <Presentation size={14} strokeWidth={1.75} className="shrink-0 text-tertiary" />;
}
