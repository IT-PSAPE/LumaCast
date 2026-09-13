import type { MediaItemProps } from './media-bin-types';
import { useMediaContextActions } from './use-media-context-actions';
import { useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { cn } from '@renderer/utils/cn';
import { Thumbnail } from '../../../components/display/thumbnail';
import { Paragraph } from '@renderer/components/display/text';
import { MediaAssetIcon } from '../../../components/display/entity-icon';
import { MediaThumbnail } from './media-thumbnail';
import { MediaContextMenuItems } from './media-context-menu-items';
import { useWorkbench } from '../../../contexts/workbench-context';
import { CheckerboardBackdrop } from '../../../components/display/checkerboard-backdrop';

export function MediaTileBody({ asset, isActive, onAssignLayer, onArmVideo }: MediaItemProps) {
  const { handleReplaceSource, handleDelete } = useMediaContextActions(asset);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete().catch(() => undefined); } });
  const {
    state: { programMode, programSingleSurface },
    actions: { setProgramSingleSurface },
  } = useWorkbench();

  function handleAssignLayer() {
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
      <div {...triggerHandlers} ref={triggerRef} className="rounded-xs focus-visible:ring-2 focus-visible:ring-brand">
        <Thumbnail.Tile
          onClick={handleAssignLayer}
          selected={isActive}
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
