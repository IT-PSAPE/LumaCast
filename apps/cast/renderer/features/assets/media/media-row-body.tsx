import type { MediaItemProps } from './media-bin-types';
import { useMediaContextActions } from './use-media-context-actions';
import { useContextMenuTrigger } from '@lumacast/ui';
import { SelectableRow } from '../../../components/display/selectable-row';
import { MediaThumbnail } from './media-thumbnail';
import { MediaContextMenuItems } from './media-context-menu-items';
import { useWorkbench } from '../../../contexts/workbench-context';

export function MediaRowBody(props: MediaItemProps) {
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

  function handleAssignLayer(event: React.MouseEvent<HTMLButtonElement>) {
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
      <SelectableRow.Root
        {...triggerHandlers}
        onContextMenuCapture={() => props.onContextMenuTarget?.(asset.id)}
        onKeyDownCapture={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) props.onContextMenuTarget?.(asset.id);
        }}
        onTouchStartCapture={() => props.onContextMenuTarget?.(asset.id)}
        ref={triggerRef}
        selected={isActive || Boolean(props.isResourceSelected)}
        onClick={handleAssignLayer}
        className="h-12 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <SelectableRow.Leading>
          <div className="relative h-10 w-10 overflow-hidden rounded-control bg-tertiary/40">
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
