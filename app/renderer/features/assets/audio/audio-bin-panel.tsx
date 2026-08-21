import { EmptyState } from '../../../components/display/empty-state';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { useAudioBin } from './use-audio-bin';
import { AudioRow } from './audio-row';

export function AudioBinPanel() {
  const {
    audioAssets,
    currentAudioAssetId,
    armAudio,
  } = useAudioBin();
  const { state: { viewMode } } = useBinControls();

  return (
    <BinShell>
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
    </BinShell>
  );
}
