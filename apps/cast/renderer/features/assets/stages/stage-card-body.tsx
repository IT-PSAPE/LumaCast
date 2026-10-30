import { useMemo, useRef } from 'react';
import type { Id } from '@lumacast/kernel';
import type { Stage } from '@lumacast/composition';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { ContextMenu, useContextMenuTrigger, useConfirm } from '@lumacast/ui';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { Thumbnail } from '../../../components/display/thumbnail';
import { SceneFrame } from '../../../components/display/scene-frame';
import { buildRenderScene } from '../../canvas/build-render-scene';
import { useStageEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useMediaProxyMap } from '../../../hooks/use-media-proxy-map';
import type { SelectionModifiers } from '@lumacast/selection';

export interface StageCardProps {
  stage: Stage;
  isActive: boolean;
  isResourceSelected?: boolean;
  onActivate: (id: Id | null) => void;
  onEdit: (id: Id) => void;
  onSelectionClick?: (id: Id, modifiers: SelectionModifiers) => boolean;
  onContextMenuTarget?: (id: Id) => void;
  onDeleteResource?: (id: Id) => Promise<void> | void;
  onDuplicateResource?: (id: Id) => Promise<void> | void;
}

export function StageCardBody({ stage, isActive, isResourceSelected, onActivate, onEdit, onSelectionClick, onContextMenuTarget, onDeleteResource, onDuplicateResource }: StageCardProps) {
  const { updateStageDraft, deleteStage, duplicateStage } = useStageEditor();
  const mediaProxyBySource = useMediaProxyMap();
  const scene = useMemo(
    () => buildRenderScene(
      { width: stage.width, height: stage.height, background: stage.background ?? null },
      stage.elements,
      { proxyMediaBySource: mediaProxyBySource },
    ),
    [mediaProxyBySource, stage.background, stage.elements, stage.height, stage.width],
  );
  const renameRef = useRef<RenameFieldHandle>(null);
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete().catch(() => undefined); } });

  function handleActivate(event: React.MouseEvent<HTMLDivElement>) {
    const modifiers = { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
    if (onSelectionClick?.(stage.id, modifiers)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onActivate(isActive ? null : stage.id);
  }

  function openEditor() {
    onEdit(stage.id);
  }

  function handleEdit(event: React.MouseEvent<HTMLDivElement>) {
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    openEditor();
  }

  function handleRename(next: string) {
    updateStageDraft({ id: stage.id, name: next });
  }

  async function handleDelete() {
    if (onDeleteResource) {
      await onDeleteResource(stage.id);
      return;
    }
    const ok = await confirm({
      title: `Delete "${stage.name}"?`,
      description: 'This stage layout will be permanently removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) await deleteStage(stage.id);
  }

  async function handleDuplicate() {
    if (onDuplicateResource) {
      await onDuplicateResource(stage.id);
      return;
    }
    await duplicateStage(stage.id);
  }

  return (
    <>
      <div
        {...triggerHandlers}
        ref={triggerRef}
        onContextMenuCapture={() => onContextMenuTarget?.(stage.id)}
        onKeyDownCapture={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) onContextMenuTarget?.(stage.id);
        }}
        onTouchStartCapture={() => onContextMenuTarget?.(stage.id)}
        className="rounded-container focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Thumbnail.Tile onClick={handleActivate} onDoubleClick={handleEdit} selected={isActive || Boolean(isResourceSelected)}>
          <Thumbnail.Body>
            <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
              <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
            </SceneFrame>
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <RenameField ref={renameRef} value={stage.name} onValueChange={handleRename} className="label-xs" />
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={openEditor}>Edit</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { void handleDuplicate().catch(() => undefined); }}>Duplicate</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete().catch(() => undefined); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
