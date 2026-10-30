import { useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { Thumbnail } from '../../components/display/thumbnail';
import { SceneFrame } from '../../components/display/scene-frame';
import { LazySceneStage } from '../../components/display/lazy-scene-stage';
import { buildRenderScene } from '../../features/canvas/build-render-scene';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { ContextMenu, useContextMenuTrigger, useConfirm } from '@lumacast/ui';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import { useStageEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useMediaProxyMap } from '../../hooks/use-media-proxy-map';
import { useStageEditorScreen } from './screen-context';

export function StageListItemBody({
  stage,
  isActive,
  selection,
  onSelect,
  onContextMenu,
}: {
  stage: ReturnType<typeof useStageEditorScreen>['state']['stages'][number];
  isActive: boolean;
  selection: ReturnType<typeof import('@lumacast/selection').useMultiSelection>;
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const { duplicateStage, deleteStage, requestNameFocus } = useStageEditor();
  const confirm = useConfirm();
  const mediaProxyBySource = useMediaProxyMap();
  const scene = useMemo(
    () => buildRenderScene(
      { width: stage.width, height: stage.height, background: stage.background ?? null },
      stage.elements,
      { proxyMediaBySource: mediaProxyBySource },
    ),
    [mediaProxyBySource, stage.background, stage.elements, stage.height, stage.width],
  );
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive);
  const { ref: triggerRef, onContextMenu: triggerContextMenu, ...triggerHandlers } = useContextMenuTrigger();
  const { containerRef, containerStyle, handleProps } = useSortableItem(stage.id);

  function handleContextMenuTrigger(event: ReactMouseEvent<HTMLElement>) {
    onContextMenu(event);
    triggerContextMenu(event);
  }

  async function handleDelete() {
    const selectedIds = selection.actionIds(stage.id);
    const isBulk = selectedIds.length > 1;
    const ok = await confirm({
      title: isBulk ? `Delete ${selectedIds.length} stages?` : `Delete "${stage.name}"?`,
      description: isBulk ? 'These stages will be permanently removed.' : 'This stage will be permanently removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) {
      for (const id of selectedIds) await deleteStage(id);
    }
  }

  function handleDuplicate() {
    for (const id of selection.actionIds(stage.id)) duplicateStage(id);
  }

  const selectedCount = selection.actionIds(stage.id).length;

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
        aria-selected={selection.selectedIds.has(stage.id)}
        selected={isActive || selection.selectedIds.has(stage.id)}
      >
        <Thumbnail.Body>
          <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
            <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
          </SceneFrame>
        </Thumbnail.Body>
        <Thumbnail.Caption>
          <span className="min-w-0 truncate text-sm text-tertiary">{stage.name}</span>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          {selectedCount === 1 ? <ContextMenu.Item onSelect={() => requestNameFocus(stage.id)}>Rename</ContextMenu.Item> : null}
          <ContextMenu.Item onSelect={handleDuplicate}>{selectedCount > 1 ? `Duplicate ${selectedCount} stages` : 'Duplicate'}</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>{selectedCount > 1 ? `Delete ${selectedCount} stages` : 'Delete'}</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
