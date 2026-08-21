import { useMemo, useRef } from 'react';
import type { Id } from '@lumacast/kernel';
import type { Overlay } from '@lumacast/composition';
import { LAYER_PREVIEW_SLIDE, overlayToLayerElements } from '@lumacast/composition';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { ContextMenu, useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { Thumbnail } from '../../../components/display/thumbnail';
import { SceneFrame } from '../../../components/display/scene-frame';
import { buildRenderScene } from '../../canvas/build-render-scene';
import { useOverlayEditor } from '../../../contexts/asset-editor/asset-editor-context';

export interface OverlayCardProps {
  overlay: Overlay;
  index: number;
  isActive: boolean;
  onActivate: (id: Id) => void;
  onEdit: (id: Id) => void;
  setWorkbenchMode: (mode: 'overlay-editor') => void;
}

export function OverlayCardBody({ overlay, index, isActive, onActivate, onEdit, setWorkbenchMode }: OverlayCardProps) {
  const { updateOverlayDraft, deleteOverlay, duplicateOverlay } = useOverlayEditor();
  const scene = useMemo(
    () => buildRenderScene({ width: LAYER_PREVIEW_SLIDE.width, height: LAYER_PREVIEW_SLIDE.height, background: overlay.background ?? null }, overlayToLayerElements(overlay)),
    [overlay],
  );
  const renameRef = useRef<RenameFieldHandle>(null);
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete(); } });

  function handleActivate() {
    onEdit(overlay.id);
    onActivate(overlay.id);
  }

  function handleEdit() {
    onEdit(overlay.id);
    setWorkbenchMode('overlay-editor');
  }

  function handleRename(next: string) {
    updateOverlayDraft({ id: overlay.id, name: next });
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
              <RenameField ref={renameRef} value={overlay.name} onValueChange={handleRename} className="label-xs" />
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={handleEdit}>Edit</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { duplicateOverlay(overlay.id); }}>Duplicate</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
