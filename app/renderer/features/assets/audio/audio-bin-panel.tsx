import type { Id, MediaAsset } from '@core/types';
import { ContextMenu, useContextMenuTrigger } from '../../../components/overlays/context-menu';
import { useConfirm } from '../../../components/overlays/confirm-dialog';
import { MediaAssetIcon } from '../../../components/display/entity-icon';
import { EmptyState } from '../../../components/display/empty-state';
import { SelectableRow } from '../../../components/display/selectable-row';
import { useAudioCoverArt } from '../../../hooks/use-audio-cover-art';
import { useElements } from '../../../contexts/canvas/canvas-context';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '../../workbench/bin-shell';
import type { BinCollectionsApi } from '../../workbench/use-bin-collections';
import { useAudioBin } from './use-audio-bin';

export function AudioBinPanel() {
  const {
    audioAssets,
    currentAudioAssetId,
    armAudio,
    collections,
    searchValue,
    setSearchValue,
    viewMode,
    setViewMode,
  } = useAudioBin();

  return (
    <BinShell
      collections={collections}
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      searchPlaceholder="Search audio…"
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      gridSize={1}
      gridSizeMin={1}
      gridSizeMax={1}
      onGridSizeChange={() => {}}
      showGridSlider={false}
    >
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
              collectionsApi={collections}
            />
          ))}
        </BinPanelLayout>
      )}
    </BinShell>
  );
}

interface AudioRowProps {
  asset: MediaAsset;
  isActive: boolean;
  onArm: (id: Id) => void;
  collectionsApi: BinCollectionsApi;
}

function AudioRow(props: AudioRowProps) {
  return (
    <ContextMenu.Root>
      <AudioRowBody {...props} />
    </ContextMenu.Root>
  );
}

function AudioRowBody({ asset, isActive, onArm, collectionsApi }: AudioRowProps) {
  const coverArt = useAudioCoverArt(asset.src);
  const { deleteMedia } = useElements();
  const confirm = useConfirm();
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();

  function handleArm() {
    onArm(asset.id);
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${asset.name}"?`,
      description: 'This audio will be removed from your library.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteMedia(asset.id);
  }

  function handleMoveToCollection(collectionId: Id) {
    void collectionsApi.assignItem('media_asset', asset.id, collectionId);
  }

  const otherCollections = collectionsApi.collections.filter((c) => c.id !== asset.collectionId);

  return (
    <>
      <SelectableRow.Root
        {...triggerHandlers}
        ref={triggerRef}
        selected={isActive}
        onClick={handleArm}
        className="h-9"
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
          {otherCollections.length > 0 ? (
            <>
              <ContextMenu.Submenu label="Move to collection">
                {otherCollections.map((collection) => (
                  <ContextMenu.Item key={collection.id} onSelect={() => handleMoveToCollection(collection.id)}>
                    {collection.name}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.Submenu>
              <ContextMenu.Separator />
            </>
          ) : null}
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
