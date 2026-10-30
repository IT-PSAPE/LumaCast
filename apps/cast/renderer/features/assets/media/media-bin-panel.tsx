import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { useConfirm } from '@lumacast/ui';
import { useElements } from '../../../contexts/canvas/canvas-context';
import { useCast } from '../../../contexts/app-context';
import { usePresentationMediaLayer, useVideo } from '../../../contexts/playback/playback-context';
import { useMultiSelection } from '@lumacast/selection';
import { useMediaTypeBin, type MediaBinKind } from './use-media-type-bin';
import { MediaBinItem } from './media-bin-item';
import { runSelectionActions, useMultiSelectionKeyHandler } from '@lumacast/selection';

interface MediaBinPanelProps {
  binKind: MediaBinKind;
}

export function MediaBinPanel({ binKind }: MediaBinPanelProps) {
  const { mediaAssets } = useMediaTypeBin(binKind);
  const { mediaLayerAssetId, videoLayerAssetId, setMediaLayerAsset } = usePresentationMediaLayer();
  const { armVideo } = useVideo();
  const { deleteMedia } = useElements();
  const { setStatusText } = useCast();
  const confirm = useConfirm();
  const { state: { viewMode, grid } } = useBinControls();
  const gridSize = grid?.value ?? (binKind === 'image' ? 6 : 3);
  const orderedIds = mediaAssets.map((asset) => asset.id);
  const selection = useMultiSelection(orderedIds, `media:${binKind}`);
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  function handleSelectionClick(id: string, modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) {
    selection.select(id, modifiers);
    return Boolean(modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey);
  }

  function handleContextMenuTarget(id: string) {
    if (!selection.selectedIds.has(id)) selection.select(id);
  }

  async function handleDeleteResource(clickedId: string) {
    const ids = selection.actionIds(clickedId);
    if (ids.length === 0) return;
    const nameById = new Map(mediaAssets.map((asset) => [asset.id, asset.name]));
    const ok = await confirm({
      title: ids.length === 1 ? `Delete "${nameById.get(ids[0]) ?? 'media'}"?` : `Delete ${ids.length} media files?`,
      description: ids.length === 1
        ? 'Slides and elements that reference this media will lose their source.'
        : 'Slides and elements that reference these media files will lose their source.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    const deleted = await runSelectionActions(ids, async (id) => {
      await deleteMedia(id);
      const name = nameById.get(id);
      if (name) setStatusText(`Deleted ${name}`);
    });
    if (deleted.ok && ids.length > 1) setStatusText(`Deleted ${ids.length} media files`);
  }

  return (
    <BinShell>
      <BinShell.Content data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode} virtualize>
          {mediaAssets.map((asset) => (
            <MediaBinItem
              key={asset.id}
              asset={asset}
              isActive={mediaLayerAssetId === asset.id || videoLayerAssetId === asset.id}
              isResourceSelected={selection.selectedIds.has(asset.id)}
              mode={viewMode}
              onAssignLayer={setMediaLayerAsset}
              onArmVideo={armVideo}
              onSelectionClick={handleSelectionClick}
              onContextMenuTarget={handleContextMenuTarget}
              onDeleteResource={handleDeleteResource}
            />
          ))}
        </BinPanelLayout>
      </BinShell.Content>
    </BinShell>
  );
}
