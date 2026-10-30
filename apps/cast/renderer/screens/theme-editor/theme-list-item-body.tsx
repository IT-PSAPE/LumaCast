import { useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { SceneFrame } from '../../components/display/scene-frame';
import { Thumbnail } from '../../components/display/thumbnail';
import { buildRenderScene } from '../../features/canvas/build-render-scene';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { ContextMenu, useContextMenuTrigger, useConfirm } from '@lumacast/ui';
import { useThemeEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import { useMediaProxyMap } from '../../hooks/use-media-proxy-map';
import { useThemeEditorScreen } from './screen-context';

export function ThemeListItemBody({
  theme,
  isActive,
  selection,
  onSelect,
  onContextMenu,
}: {
  theme: ReturnType<typeof useThemeEditorScreen>['state']['themes'][number];
  isActive: boolean;
  selection: ReturnType<typeof import('@lumacast/selection').useMultiSelection>;
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
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

  function handleCaptionDoubleClick(event: React.MouseEvent) {
    event.stopPropagation();
    requestNameFocus(theme.id);
  }

  function handleContextMenuTrigger(event: ReactMouseEvent<HTMLElement>) {
    onContextMenu(event);
    triggerContextMenu(event);
  }

  async function handleDelete() {
    const selectedIds = selection.actionIds(theme.id);
    const isBulk = selectedIds.length > 1;
    const ok = await confirm({
      title: isBulk ? `Delete ${selectedIds.length} themes?` : `Delete "${theme.name}"?`,
      description: isBulk ? 'These themes will be permanently removed.' : 'This theme will be permanently removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) {
      for (const id of selectedIds) deleteTheme(id);
    }
  }

  function handleDuplicate() {
    for (const id of selection.actionIds(theme.id)) duplicateTheme(id);
  }

  const selectedCount = selection.actionIds(theme.id).length;

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
        onContextMenu={handleContextMenuTrigger}
        onClick={onSelect}
        aria-selected={selection.selectedIds.has(theme.id)}
        selected={isActive || selection.selectedIds.has(theme.id)}
      >
        <Thumbnail.Body>
          <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
            <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
          </SceneFrame>
        </Thumbnail.Body>
        <Thumbnail.Caption>
          <div onDoubleClick={handleCaptionDoubleClick}>
            <span className="min-w-0 truncate text-sm text-tertiary">{theme.name}</span>
          </div>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          {selectedCount === 1 ? <ContextMenu.Item onSelect={() => requestNameFocus(theme.id)}>Rename</ContextMenu.Item> : null}
          <ContextMenu.Item onSelect={handleDuplicate}>{selectedCount > 1 ? `Duplicate ${selectedCount} themes` : 'Duplicate'}</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>{selectedCount > 1 ? `Delete ${selectedCount} themes` : 'Delete'}</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
