import { useMemo, useRef } from 'react';
import type { Id } from '@lumacast/kernel';
import type { Stage } from '@lumacast/composition';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { ContextMenu, useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { Thumbnail } from '../../../components/display/thumbnail';
import { SceneFrame } from '../../../components/display/scene-frame';
import { buildRenderScene } from '../../canvas/build-render-scene';
import { useStageEditor } from '../../../contexts/asset-editor/asset-editor-context';

export interface StageCardProps {
  stage: Stage;
  index: number;
  isActive: boolean;
  onActivate: (id: Id | null) => void;
  onEdit: (id: Id) => void;
}

export function StageCardBody({ stage, index, isActive, onActivate, onEdit }: StageCardProps) {
  const { updateStageDraft, deleteStage, duplicateStage } = useStageEditor();
  const scene = useMemo(
    () => buildRenderScene({ width: stage.width, height: stage.height, background: stage.background ?? null }, stage.elements),
    [stage.background, stage.elements, stage.height, stage.width],
  );
  const renameRef = useRef<RenameFieldHandle>(null);
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete(); } });

  function handleActivate() {
    onActivate(isActive ? null : stage.id);
  }

  function handleEdit() {
    onEdit(stage.id);
  }

  function handleRename(next: string) {
    updateStageDraft({ id: stage.id, name: next });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${stage.name}"?`,
      description: 'This stage layout will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteStage(stage.id);
  }

  return (
    <>
      <div {...triggerHandlers} ref={triggerRef} className="rounded-xs focus-visible:ring-2 focus-visible:ring-brand">
        <Thumbnail.Tile onClick={handleActivate} onDoubleClick={handleEdit} selected={isActive}>
          <Thumbnail.Body>
            <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
              <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
            </SceneFrame>
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
              <RenameField ref={renameRef} value={stage.name} onValueChange={handleRename} className="label-xs" />
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={handleEdit}>Edit</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { duplicateStage(stage.id); }}>Duplicate</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
