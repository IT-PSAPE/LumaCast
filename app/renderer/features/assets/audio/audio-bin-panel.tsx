import type { Id } from '@lumacast/kernel';
import type { MediaAsset } from '@lumacast/composition';
import { ContextMenu, useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { MediaAssetIcon } from '../../../components/display/entity-icon';
import { EmptyState } from '../../../components/display/empty-state';
import { SelectableRow } from '../../../components/display/selectable-row';
import { useAudioCoverArt } from '../../../hooks/use-audio-cover-art';
import { useElements } from '../../../contexts/canvas/canvas-context';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '../../workbench/bin-shell';
import { useAudioBin } from './use-audio-bin';

export function AudioBinPanel() {
  const {
    audioAssets,
    currentAudioAssetId,
    armAudio,
    searchValue,
    setSearchValue,
    viewMode,
    setViewMode,
  } = useAudioBin();

  return (
    <BinShell
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchPlaceholder="Search audio…"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
    >
      <BinShell.Content>
        {audioAssets.length === 0 ? (
          <EmptyState.Root>
            <EmptyState.Title>No audio files</EmptyState.Title>
            <EmptyState.Description>Import audio to build a reusable app-wide audio list.</EmptyState.Description>
          </EmptyState.Root>
        ) : (
          <BinPanelLayout gridItemSize={1} mode={viewMode}>
            {audioAssets.map((asset) => (
              <AudioRow
                key={asset.id}
                asset={asset}
                isActive={currentAudioAssetId === asset.id}
                onArm={armAudio}
              />
            ))}
          </BinPanelLayout>
        )}
      </BinShell.Content>
      <BinShell.Footer>
        <BinShell.Search />
        <BinShell.ViewToggle />
      </BinShell.Footer>
    </BinShell>
  );
}

interface AudioRowProps {
  asset: MediaAsset;
  isActive: boolean;
  onArm: (id: Id) => void;
}

function AudioRow(props: AudioRowProps) {
  return (
    <ContextMenu.Root>
      <AudioRowBody {...props} />
    </ContextMenu.Root>
  );
}

function AudioRowBody({ asset, isActive, onArm }: AudioRowProps) {
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
