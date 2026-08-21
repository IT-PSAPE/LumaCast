import type { AudioRowProps } from './audio-bin-types';
import { useAudioCoverArt } from '../../../hooks/use-audio-cover-art';
import { useElements } from '../../../contexts/canvas/canvas-context';
import { useContextMenuTrigger, ContextMenu } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { MediaAssetIcon } from '../../../components/display/entity-icon';
import { SelectableRow } from '../../../components/display/selectable-row';

export function AudioRowBody({ asset, isActive, onArm }: AudioRowProps) {
  const coverArt = useAudioCoverArt(asset.src);
  const { deleteMedia } = useElements();
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete().catch(() => undefined); } });

  function handleArm() {
    onArm(asset.id);
  }

  // deleteMedia → deleteMediaAsset rejects when the asset no longer exists
  // (#214); mutatePatch has already reported the failure (#221), so the
  // rethrow is absorbed at the call sites below.
  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${asset.name}"?`,
      description: 'This audio will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteMedia(asset.id);
  }

  return (
    <>
      <SelectableRow.Root
        {...triggerHandlers}
        ref={triggerRef}
        selected={isActive}
        onClick={handleArm}
        className="h-9 focus-visible:ring-2 focus-visible:ring-brand"
      >
        <SelectableRow.Leading>
          {coverArt ? (
            <img src={coverArt} alt="" className="h-6 w-6 rounded object-cover" />
          ) : (
            <MediaAssetIcon asset={asset} size={14} strokeWidth={1.75} className="shrink-0 text-tertiary" />
          )}
        </SelectableRow.Leading>
        <SelectableRow.Label>{asset.name}</SelectableRow.Label>
      </SelectableRow.Root>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete().catch(() => undefined); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
