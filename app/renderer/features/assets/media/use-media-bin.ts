import { useMemo } from 'react';
import type { Id } from '@core/types';
import { usePresentationMediaLayer } from '../../../contexts/playback/playback-context';
import { useProjectContent } from '../../../contexts/use-project-content';
import { filterByText } from '../../../utils/filter-by-text';
import { compareByKey, useMediaBinSort } from '../../workbench/use-bin-sort';

export function useMediaBin(filterText: string) {
  const { mediaAssets: allMediaAssets } = useProjectContent();
  const { mediaLayerAssetId, videoLayerAssetId, setMediaLayerAsset } = usePresentationMediaLayer();
  const { sort } = useMediaBinSort();

  const mediaAssets = useMemo(() => {
    const filtered = filterByText(
      allMediaAssets.filter((asset) => asset.type !== 'audio'),
      filterText,
      (asset) => [asset.name, asset.type],
    );
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => direction * compareByKey(a, b, sort.key, (item) => item.name));
  }, [allMediaAssets, filterText, sort]);

  function handleApply(assetId: Id) {
    setMediaLayerAsset(assetId);
  }

  return { mediaAssets, mediaLayerAssetId, videoLayerAssetId, setMediaLayerAsset, handleApply };
}
