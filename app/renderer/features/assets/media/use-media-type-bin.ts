import { useMemo } from 'react';
import type { MediaAsset } from '@lumacast/composition';
import { useProjectContent } from '../../../contexts/use-project-content';
import { filterByText } from '../../../utils/filter-by-text';
import { compareByKey, useMediaBinSort } from '../../workbench/use-bin-sort';
import { useBinControls } from '@renderer/components/controls/bin-controls';

export type MediaBinKind = 'image' | 'video' | 'audio';

const TYPE_FILTERS: Record<MediaBinKind, (asset: MediaAsset) => boolean> = {
  image: (asset) => asset.type === 'image',
  video: (asset) => asset.type === 'video',
  audio: (asset) => asset.type === 'audio',
};

export function useMediaTypeBin(
  binKind: MediaBinKind,
) {
  const { mediaAssets: allMediaAssets } = useProjectContent();
  const { sort } = useMediaBinSort();
  const { state: { searchValue } } = useBinControls();

  const filteredByType = useMemo(
    () => allMediaAssets.filter(TYPE_FILTERS[binKind]),
    [allMediaAssets, binKind],
  );

  const mediaAssets = useMemo(() => {
    const filtered = filterByText(
      filteredByType,
      searchValue,
      (asset) => [asset.name, asset.type],
    );
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => direction * compareByKey(a, b, sort.key, (item) => item.name));
  }, [filteredByType, searchValue, sort]);

  return {
    mediaAssets,
  };
}
