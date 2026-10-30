import { useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { LAYER_PREVIEW_SLIDE, overlayToLayerElements } from '@lumacast/composition';
import { Thumbnail } from '../../components/display/thumbnail';
import { SceneFrame } from '../../components/display/scene-frame';
import { LazySceneStage } from '../../components/display/lazy-scene-stage';
import { buildRenderScene } from '../../features/canvas/build-render-scene';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { ContextMenu, useContextMenuTrigger, useConfirm } from '@lumacast/ui';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import { useOverlayEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useMediaProxyMap } from '../../hooks/use-media-proxy-map';
import { useOverlayEditorScreen } from './screen-context';

export function OverlayListItemBody({
  overlay,
  isActive,
  selection,
  onSelect,
  onContextMenu,
}: {
  overlay: ReturnType<typeof useOverlayEditorScreen>['state']['overlays'][number];
  isActive: boolean;
  selection: ReturnType<typeof import('@lumacast/selection').useMultiSelection>;
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const { duplicateOverlay, deleteOverlay, requestNameFocus } = useOverlayEditor();
  const confirm = useConfirm();
  const mediaProxyBySource = useMediaProxyMap();
  const scene = useMemo(
    () => buildRenderScene(
      { width: LAYER_PREVIEW_SLIDE.width, height: LAYER_PREVIEW_SLIDE.height, background: overlay.background ?? null },
      overlayToLayerElements(overlay),
      { proxyMediaBySource: mediaProxyBySource },
    ),
    [mediaProxyBySource, overlay.background, overlay.elements],
  );
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive);
  const { ref: triggerRef, onContextMenu: triggerContextMenu, ...triggerHandlers } = useContextMenuTrigger();
  const { containerRef, containerStyle, handleProps } = useSortableItem(overlay.id);

  function handleContextMenuTrigger(event: ReactMouseEvent<HTMLElement>) {
    onContextMenu(event);
    triggerContextMenu(event);
  }

  async function handleDelete() {
    const selectedIds = selection.actionIds(overlay.id);
    const isBulk = selectedIds.length > 1;
    const ok = await confirm({
      title: isBulk ? `Delete ${selectedIds.length} overlays?` : `Delete "${overlay.name}"?`,
      description: isBulk ? 'These overlays will be permanently removed.' : 'This overlay will be permanently removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) {
      for (const id of selectedIds) await deleteOverlay(id);
    }
  }

  function handleDuplicate() {
    for (const id of selection.actionIds(overlay.id)) duplicateOverlay(id);
  }

  const selectedCount = selection.actionIds(overlay.id).length;

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
        aria-selected={selection.selectedIds.has(overlay.id)}
        selected={isActive || selection.selectedIds.has(overlay.id)}
      >
        <Thumbnail.Body>
          <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
            <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
          </SceneFrame>
        </Thumbnail.Body>
        <Thumbnail.Caption>
          <span className="min-w-0 truncate text-sm text-tertiary">{overlay.name}</span>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          {selectedCount === 1 ? <ContextMenu.Item onSelect={() => requestNameFocus(overlay.id)}>Rename</ContextMenu.Item> : null}
          <ContextMenu.Item onSelect={handleDuplicate}>{selectedCount > 1 ? `Duplicate ${selectedCount} overlays` : 'Duplicate'}</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>{selectedCount > 1 ? `Delete ${selectedCount} overlays` : 'Delete'}</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
