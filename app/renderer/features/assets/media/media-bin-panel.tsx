import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { usePresentationMediaLayer, useVideo } from '../../../contexts/playback/playback-context';
import { useMediaTypeBin, type MediaBinKind } from './use-media-type-bin';
import { MediaBinItem } from './media-bin-item';

interface MediaBinPanelProps {
  binKind: MediaBinKind;
}

export function MediaBinPanel({ binKind }: MediaBinPanelProps) {
  const { mediaAssets } = useMediaTypeBin(binKind);
  const { mediaLayerAssetId, videoLayerAssetId, setMediaLayerAsset } = usePresentationMediaLayer();
  const { armVideo } = useVideo();
  const { state: { viewMode, grid } } = useBinControls();
  const gridSize = grid?.value ?? (binKind === 'image' ? 6 : 3);

  return (
    <BinShell>
      <BinShell.Content>
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode} virtualize>
          {mediaAssets.map((asset) => (
            <MediaBinItem
              key={asset.id}
              asset={asset}
              isActive={mediaLayerAssetId === asset.id || videoLayerAssetId === asset.id}
              mode={viewMode}
              onAssignLayer={setMediaLayerAsset}
              onArmVideo={armVideo}
            />
          ))}
        </BinPanelLayout>
      </BinShell.Content>
    </BinShell>
  );
}
