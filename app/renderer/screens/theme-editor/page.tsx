import { useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import type { ThemeOwnerType } from '@lumacast/composition';
import { Plus } from 'lucide-react';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { SceneFrame } from '../../components/display/scene-frame';
import { Thumbnail } from '../../components/display/thumbnail';
import { Dropdown } from '../../components/form/dropdown';
import { buildRenderScene } from '../../features/canvas/build-render-scene';
import { StagePanel } from '../../features/canvas/stage-panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { Label } from '@renderer/components/display/text';
import { ScrollArea, useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useThemeEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { SortableList, useSortableItem, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { ThemeEditorInspectorPanel } from './inspector-panel';
import { ThemeEditorLayersPanel } from './layers-panel';
import { ThemeEditorScreenProvider, useThemeEditorScreen } from './screen-context';

function singular(label: string): string {
  return label.replace(/s$/, '').toLowerCase();
}

const THEME_SECTIONS: ReadonlyArray<{ type: ThemeOwnerType; label: string }> = [
  { type: 'presentation', label: 'Presentations' },
  { type: 'lyric', label: 'Lyrics' },
  { type: 'talk', label: 'Talks' },
  { type: 'overlay', label: 'Overlays' },
];

export function ThemeEditorScreen() {
  return (
    <ThemeEditorScreenProvider>
      <ThemeEditorScreenContent />
    </ThemeEditorScreenProvider>
  );
}

function ThemeEditorScreenContent() {
  const { actions, state } = useThemeEditorScreen();
  const allEmpty = THEME_SECTIONS.every(({ type }) => state.themesByType[type].length === 0);

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
                      {THEME_SECTIONS.map(({ type, label }) => (
                        <Dropdown.Item key={type} onClick={() => actions.createTheme(type)}>
                          New {singular(label)} theme
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Panel>
                  </Dropdown>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content>
                  <ScrollArea.Root scrollPadding={8}>
                    <ScrollArea.Viewport className="p-2">
                      <div className="flex flex-col gap-4">
                        {allEmpty ? (
                          <p className="px-1 text-xs text-tertiary">No themes yet.</p>
                        ) : null}
                        {THEME_SECTIONS.map(({ type, label }) => (
                          <ThemeFamilySection key={type} themeType={type} label={label} />
                        ))}
                      </div>
                    </ScrollArea.Viewport>
                    <ScrollArea.Scrollbar>
                      <ScrollArea.Thumb />
                    </ScrollArea.Scrollbar>
                  </ScrollArea.Root>
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

function ThemeFamilySection({ themeType, label }: { themeType: ThemeOwnerType; label: string }) {
  const { state, actions } = useThemeEditorScreen();
  const themes = state.themesByType[themeType];

  return (
    <div className="flex flex-col gap-1.5">
      <Label.xs className="px-1 text-tertiary">{label}</Label.xs>
      {themes.length === 0 ? (
        <button
          type="button"
          onClick={() => actions.createTheme(themeType)}
          aria-label={`Create ${singular(label)} theme`}
          className="flex w-full items-center justify-center gap-1.5 rounded-xs border border-dashed border-tertiary/70 px-2 py-2.5 text-tertiary transition-colors hover:border-secondary hover:text-secondary focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden />
          <span className="text-xs">Create {singular(label)} theme</span>
        </button>
      ) : (
        <ThemeFamilyList themeType={themeType} themes={themes} />
      )}
    </div>
  );
}

const themeId = (theme: ReturnType<typeof useThemeEditorScreen>['state']['themes'][number]) => theme.id;

function ThemeFamilyList({
  themeType,
  themes: sourceThemes,
}: {
  themeType: ThemeOwnerType;
  themes: ReturnType<typeof useThemeEditorScreen>['state']['themesByType'][ThemeOwnerType];
}) {
  const { state } = useThemeEditorScreen();
  const { reorderTheme } = useThemeEditor();

  const commitReorder = useCallback(
    ({ id, toIndex }: SortableOrderCommit) => reorderTheme(id, toIndex),
    [reorderTheme],
  );

  const { items: themes, dnd } = useSortableOrder({
    items: sourceThemes as ReturnType<typeof useThemeEditorScreen>['state']['themes'],
    getId: themeId,
    commit: commitReorder,
  });

  return (
    <SortableList.Root {...dnd}>
      <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label={themeType}>
        {themes.map((theme, index) => (
          <ThemeListItem key={theme.id} theme={theme} themeType={themeType} index={index} isActive={theme.id === state.currentThemeId} />
        ))}
      </div>
    </SortableList.Root>
  );
}

function ThemeListItem(props: {
  theme: ReturnType<typeof useThemeEditorScreen>['state']['themes'][number];
  themeType: ThemeOwnerType;
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
  themeType,
  index,
  isActive,
}: {
  theme: ReturnType<typeof useThemeEditorScreen>['state']['themes'][number];
  themeType: ThemeOwnerType;
  index: number;
  isActive: boolean;
}) {
  const { actions } = useThemeEditorScreen();
  const { duplicateTheme, deleteTheme, requestNameFocus } = useThemeEditor();
  const confirm = useConfirm();
  const scene = useMemo(() => buildRenderScene({ width: theme.width, height: theme.height, background: theme.background ?? null }, theme.elements), [theme.background, theme.elements, theme.height, theme.width]);
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive);
  const { ref: triggerRef, onContextMenu: triggerContextMenu, ...triggerHandlers } = useContextMenuTrigger();
  const { containerRef, containerStyle, handleProps } = useSortableItem(theme.id);

  function handleSelect() {
    actions.selectTheme(themeType, theme.id);
  }

  function handleCaptionDoubleClick(event: React.MouseEvent) {
    event.stopPropagation();
    actions.requestThemeNameFocus(theme.id);
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!isActive) actions.selectTheme(themeType, theme.id);
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
        {...handleProps}
        ref={(node) => {
          activeRef.current = node;
          triggerRef(node);
          containerRef(node);
        }}
        style={containerStyle}
        className="cursor-grab active:cursor-grabbing"
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
