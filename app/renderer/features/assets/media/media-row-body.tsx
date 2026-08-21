import type { MediaItemProps } from './media-bin-types';
import { useMediaContextActions } from './use-media-context-actions';
import { useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { SelectableRow } from '../../../components/display/selectable-row';
import { MediaThumbnail } from './media-thumbnail';
import { MediaContextMenuItems } from './media-context-menu-items';
import { useWorkbench } from '../../../contexts/workbench-context';

export function MediaRowBody({ asset, isActive, onAssignLayer, onArmVideo }: MediaItemProps) {
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
      <SelectableRow.Root
        {...triggerHandlers}
        ref={triggerRef}
        selected={isActive}
        onClick={handleAssignLayer}
        className="h-12 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <SelectableRow.Leading>
          <div className="relative h-10 w-10 overflow-hidden rounded bg-tertiary/40">
            <MediaThumbnail asset={asset} />
          </div>
        </SelectableRow.Leading>
        <div className="flex min-w-0 flex-1 flex-col text-left">
          <span className="truncate text-sm font-medium">{asset.name}</span>
          <span className="truncate text-xs uppercase tracking-wide text-tertiary">{asset.type}</span>
        </div>
      </SelectableRow.Root>
      <MediaContextMenuItems
        onReplaceSource={() => { void handleReplaceSource().catch(() => undefined); }}
        onDelete={() => { void handleDelete().catch(() => undefined); }}
      />
    </>
  );
}
