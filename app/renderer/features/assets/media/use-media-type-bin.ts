import { useMemo, useState } from 'react';
import type { MediaAsset } from '@lumacast/composition';
import { useProjectContent } from '../../../contexts/use-project-content';
import { filterByText } from '../../../utils/filter-by-text';
import { compareByKey, useMediaBinSort } from '../../workbench/use-bin-sort';
import type { ResourceDrawerViewMode } from '../../../types/ui';

export type MediaBinKind = 'image' | 'video' | 'audio';

const TYPE_FILTERS: Record<MediaBinKind, (asset: MediaAsset) => boolean> = {
  image: (asset) => asset.type === 'image',
  video: (asset) => asset.type === 'video',
  audio: (asset) => asset.type === 'audio',
};

export function useMediaTypeBin(
  binKind: MediaBinKind,
  defaultViewMode: ResourceDrawerViewMode = 'grid',
) {
  const { mediaAssets: allMediaAssets } = useProjectContent();
  const { sort } = useMediaBinSort();

  const [searchValue, setSearchValue] = useState('');
  const [viewMode, setViewMode] = useState<ResourceDrawerViewMode>(defaultViewMode);

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
    searchValue,
    setSearchValue,
    viewMode,
    setViewMode,
  };
}
