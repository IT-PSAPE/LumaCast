import type { MouseEvent as ReactMouseEvent } from 'react';
import { Thumbnail } from '../../components/display/thumbnail';
import { SceneFrame } from '../../components/display/scene-frame';
import { buildRenderScene } from '../../features/canvas/build-render-scene';
import { SceneStage } from '../../features/canvas/scene-stage';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useConfirm } from '@renderer/components/overlays/confirm-dialog';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import { useStageEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useStageEditorScreen } from './screen-context';

export function StageListItemBody({
  stage,
  index,
  isActive,
}: {
  stage: ReturnType<typeof useStageEditorScreen>['state']['stages'][number];
  index: number;
  isActive: boolean;
}) {
  const { actions } = useStageEditorScreen();
  const { duplicateStage, deleteStage, requestNameFocus } = useStageEditor();
  const confirm = useConfirm();
  const scene = buildRenderScene({ width: stage.width, height: stage.height, background: stage.background ?? null }, stage.elements);
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive);
  const { ref: triggerRef, onContextMenu: triggerContextMenu, ...triggerHandlers } = useContextMenuTrigger();
  const { containerRef, containerStyle, handleProps } = useSortableItem(stage.id);

  function handleSelect() {
    actions.selectStage(stage.id);
  }

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!isActive) actions.selectStage(stage.id);
    triggerContextMenu(event);
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${stage.name}"?`,
      description: 'This stage will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteStage(stage.id);
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
            <span className="min-w-0 truncate text-sm text-tertiary">{stage.name}</span>
          </div>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => requestNameFocus(stage.id)}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => duplicateStage(stage.id)}>Duplicate</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
