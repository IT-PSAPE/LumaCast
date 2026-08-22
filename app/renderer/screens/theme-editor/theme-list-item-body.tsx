import { useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import type { ThemeOwnerType } from '@lumacast/composition';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { SceneFrame } from '../../components/display/scene-frame';
import { Thumbnail } from '../../components/display/thumbnail';
import { buildRenderScene } from '../../features/canvas/build-render-scene';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useThemeEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import { useMediaProxyMap } from '../../hooks/use-media-proxy-map';
import { useThemeEditorScreen } from './screen-context';

export function ThemeListItemBody({
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
  const mediaProxyBySource = useMediaProxyMap();
  const scene = useMemo(
    () => buildRenderScene(
      { width: theme.width, height: theme.height, background: theme.background ?? null },
      theme.elements,
      { proxyMediaBySource: mediaProxyBySource },
    ),
    [mediaProxyBySource, theme.background, theme.elements, theme.height, theme.width],
  );
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
