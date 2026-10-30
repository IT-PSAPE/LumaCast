import { useMemo, useRef } from 'react';
import type { Id } from '@lumacast/kernel';
import type { Overlay } from '@lumacast/composition';
import { LAYER_PREVIEW_SLIDE, overlayToLayerElements } from '@lumacast/composition';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { ContextMenu, useContextMenuTrigger, useConfirm } from '@lumacast/ui';
import { RenameField, type RenameFieldHandle } from '../../../components/form/rename-field';
import { Thumbnail } from '../../../components/display/thumbnail';
import { SceneFrame } from '../../../components/display/scene-frame';
import { buildRenderScene } from '../../canvas/build-render-scene';
import { useOverlayEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useMediaProxyMap } from '../../../hooks/use-media-proxy-map';
import type { SelectionModifiers } from '@lumacast/selection';

export interface OverlayCardProps {
  overlay: Overlay;
  isActive: boolean;
  isResourceSelected?: boolean;
  onActivate: (id: Id) => void;
  onEdit: (id: Id) => void;
  setWorkbenchMode: (mode: 'overlay-editor') => void;
  onSelectionClick?: (id: Id, modifiers: SelectionModifiers) => boolean;
  onContextMenuTarget?: (id: Id) => void;
  onDeleteResource?: (id: Id) => Promise<void> | void;
  onDuplicateResource?: (id: Id) => Promise<void> | void;
}

export function OverlayCardBody({ overlay, isActive, isResourceSelected, onActivate, onEdit, setWorkbenchMode, onSelectionClick, onContextMenuTarget, onDeleteResource, onDuplicateResource }: OverlayCardProps) {
  const { updateOverlayDraft, deleteOverlay, duplicateOverlay } = useOverlayEditor();
  const mediaProxyBySource = useMediaProxyMap();
  const scene = useMemo(
    () => buildRenderScene(
      { width: LAYER_PREVIEW_SLIDE.width, height: LAYER_PREVIEW_SLIDE.height, background: overlay.background ?? null },
      overlayToLayerElements(overlay),
      { proxyMediaBySource: mediaProxyBySource },
    ),
    [mediaProxyBySource, overlay],
  );
  const renameRef = useRef<RenameFieldHandle>(null);
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete().catch(() => undefined); } });

  function handleActivate(event: React.MouseEvent<HTMLDivElement>) {
    const modifiers = { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
    if (onSelectionClick?.(overlay.id, modifiers)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onEdit(overlay.id);
    onActivate(overlay.id);
  }

  function openEditor() {
    onEdit(overlay.id);
    setWorkbenchMode('overlay-editor');
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
    updateOverlayDraft({ id: overlay.id, name: next });
  }

  async function handleDelete() {
    if (onDeleteResource) {
      await onDeleteResource(overlay.id);
      return;
    }
    const ok = await confirm({
      title: `Delete "${overlay.name}"?`,
      description: 'This overlay will be permanently removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) await deleteOverlay(overlay.id);
  }

  async function handleDuplicate() {
    if (onDuplicateResource) {
      await onDuplicateResource(overlay.id);
      return;
    }
    await duplicateOverlay(overlay.id);
  }

  return (
    <>
      <div
        {...triggerHandlers}
        ref={triggerRef}
        onContextMenuCapture={() => onContextMenuTarget?.(overlay.id)}
        onKeyDownCapture={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) onContextMenuTarget?.(overlay.id);
        }}
        onTouchStartCapture={() => onContextMenuTarget?.(overlay.id)}
        className="rounded-container focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Thumbnail.Tile onClick={handleActivate} onDoubleClick={handleEdit} selected={isActive || Boolean(isResourceSelected)}>
          <Thumbnail.Body>
            <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
              <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
            </SceneFrame>
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <RenameField ref={renameRef} value={overlay.name} onValueChange={handleRename} className="label-xs" />
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
