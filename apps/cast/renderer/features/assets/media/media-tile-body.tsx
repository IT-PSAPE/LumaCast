import type { MediaItemProps } from './media-bin-types';
import { useMediaContextActions } from './use-media-context-actions';
import { useContextMenuTrigger, cn, Paragraph } from '@lumacast/ui';
import { Thumbnail } from '../../../components/display/thumbnail';
import { MediaAssetIcon } from '../../../components/display/entity-icon';
import { MediaThumbnail } from './media-thumbnail';
import { MediaContextMenuItems } from './media-context-menu-items';
import { useWorkbench } from '../../../contexts/workbench-context';
import { CheckerboardBackdrop } from '../../../components/display/checkerboard-backdrop';

export function MediaTileBody(props: MediaItemProps) {
  const { asset, isActive, onAssignLayer, onArmVideo } = props;
  const { handleReplaceSource, handleDelete: handleDeleteSingle } = useMediaContextActions(asset);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete().catch(() => undefined); } });
  const {
    state: { programMode, programSingleSurface },
    actions: { setProgramSingleSurface },
  } = useWorkbench();

  async function handleDelete() {
    if (props.onDeleteResource) {
      await props.onDeleteResource(asset.id);
      return;
    }
    await handleDeleteSingle();
  }

  function handleAssignLayer(event: React.MouseEvent<HTMLDivElement>) {
    const modifiers = { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
    const selectionOnly = props.onSelectionClick?.(asset.id, modifiers) ?? false;
    if (selectionOnly) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if ((asset.type === 'video') && programMode === 'single' && programSingleSurface !== 'program') {
      setProgramSingleSurface('program');
    }
    if (asset.type === 'video') {
      onArmVideo(asset.id);
      return;
    }
    onAssignLayer(asset.id);
  }

  return (
    <>
      <div
        {...triggerHandlers}
        ref={triggerRef}
        onContextMenuCapture={() => props.onContextMenuTarget?.(asset.id)}
        onKeyDownCapture={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) props.onContextMenuTarget?.(asset.id);
        }}
        onTouchStartCapture={() => props.onContextMenuTarget?.(asset.id)}
        className="rounded-container focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Thumbnail.Tile
          onClick={handleAssignLayer}
          selected={isActive || Boolean(props.isResourceSelected)}
          aspectRatio={asset.type === 'audio' ? 1 : undefined}
          className={cn(isActive ? 'ring-1 ring-brand/35' : '')}
        >
          <Thumbnail.Body>
            <CheckerboardBackdrop size={16} />
            <MediaThumbnail asset={asset} />
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <div className="flex min-w-0 items-center gap-1 text-sm text-secondary">
              <MediaAssetIcon asset={asset} size={12} strokeWidth={1.75} className="shrink-0 text-tertiary" />
              <Paragraph.xs className="truncate">{asset.name}</Paragraph.xs>
            </div>
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <MediaContextMenuItems
        onReplaceSource={() => { void handleReplaceSource().catch(() => undefined); }}
        onDelete={() => { void handleDelete().catch(() => undefined); }}
      />
    </>
  );
}
