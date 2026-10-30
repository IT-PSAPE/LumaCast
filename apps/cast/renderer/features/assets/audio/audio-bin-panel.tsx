import { EmptyState } from '@lumacast/ui';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { useConfirm } from '@lumacast/ui';
import { useElements } from '../../../contexts/canvas/canvas-context';
import { useCast } from '../../../contexts/app-context';
import { useMultiSelection } from '@lumacast/selection';
import { useAudioBin } from './use-audio-bin';
import { AudioRow } from './audio-row';
import { runSelectionActions, useMultiSelectionKeyHandler } from '@lumacast/selection';

export function AudioBinPanel() {
  const {
    audioAssets,
    currentAudioAssetId,
    armAudio,
  } = useAudioBin();
  const { deleteMedia } = useElements();
  const { setStatusText } = useCast();
  const confirm = useConfirm();
  const { state: { viewMode } } = useBinControls();
  const orderedIds = audioAssets.map((asset) => asset.id);
  const selection = useMultiSelection(orderedIds, 'audio');
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
    const nameById = new Map(audioAssets.map((asset) => [asset.id, asset.name]));
    const ok = await confirm({
      title: ids.length === 1 ? `Delete "${nameById.get(ids[0]) ?? 'audio'}"?` : `Delete ${ids.length} audio files?`,
      description: ids.length === 1
        ? 'This audio will be permanently removed.'
        : 'These audio files will be permanently removed.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    const deleted = await runSelectionActions(ids, async (id) => {
      await deleteMedia(id);
      const name = nameById.get(id);
      if (name) setStatusText(`Deleted ${name}`);
    });
    if (deleted.ok && ids.length > 1) setStatusText(`Deleted ${ids.length} audio files`);
  }

  return (
    <BinShell>
      <BinShell.Content data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        {audioAssets.length === 0 ? (
          <EmptyState.Root>
            <EmptyState.Title>No audio files</EmptyState.Title>
            <EmptyState.Description>Import audio to build a reusable app-wide audio list.</EmptyState.Description>
          </EmptyState.Root>
        ) : (
          <div data-shortcuts-scope="audio-focus" className="contents">
            <BinPanelLayout gridItemSize={1} mode={viewMode} virtualize>
              {audioAssets.map((asset) => (
                <AudioRow
                  key={asset.id}
                  asset={asset}
                  isActive={currentAudioAssetId === asset.id}
                  onArm={armAudio}
                  isResourceSelected={selection.selectedIds.has(asset.id)}
                  onSelectionClick={handleSelectionClick}
                  onContextMenuTarget={handleContextMenuTarget}
                  onDeleteResource={handleDeleteResource}
                />
              ))}
            </BinPanelLayout>
          </div>
        )}
      </BinShell.Content>
    </BinShell>
  );
}
