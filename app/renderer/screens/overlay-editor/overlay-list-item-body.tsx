import type { MouseEvent as ReactMouseEvent } from 'react';
import { LAYER_PREVIEW_SLIDE, overlayToLayerElements } from '@lumacast/composition';
import { Thumbnail } from '../../components/display/thumbnail';
import { SceneFrame } from '../../components/display/scene-frame';
import { buildRenderScene } from '../../features/canvas/build-render-scene';
import { SceneStage } from '../../features/canvas/scene-stage';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import { useOverlayEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useOverlayEditorScreen } from './screen-context';

export function OverlayListItemBody({
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
  const { containerRef, containerStyle, handleProps } = useSortableItem(overlay.id);

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
