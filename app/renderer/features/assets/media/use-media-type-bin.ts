import { useMemo, useState } from 'react';
import type { CollectionBinKind, Id, MediaAsset } from '@core/types';
import { useProjectContent } from '../../../contexts/use-project-content';
import { filterByText } from '../../../utils/filter-by-text';
import { compareByKey, useMediaBinSort } from '../../workbench/use-bin-sort';
import { useBinCollections } from '../../workbench/use-bin-collections';
import type { ResourceDrawerViewMode } from '../../../types/ui';

export type MediaBinKind = Extract<CollectionBinKind, 'image' | 'video' | 'audio'>;

const TYPE_FILTERS: Record<MediaBinKind, (asset: MediaAsset) => boolean> = {
  image: (asset) => asset.type === 'image',
  video: (asset) => asset.type === 'video',
  audio: (asset) => asset.type === 'audio',
};

export function useMediaTypeBin(binKind: MediaBinKind, defaultViewMode: ResourceDrawerViewMode = 'grid') {
  const { mediaAssets: allMediaAssets } = useProjectContent();
  const collections = useBinCollections(binKind);
  const { sort } = useMediaBinSort();

  const [searchValue, setSearchValue] = useState('');
  const [viewMode, setViewMode] = useState<ResourceDrawerViewMode>(defaultViewMode);

  const filteredByType = useMemo(
    () => allMediaAssets.filter(TYPE_FILTERS[binKind]),
    [allMediaAssets, binKind],
  );

  const filteredByCollection = useMemo(
    () => collections.filterByActiveCollection(filteredByType),
    [filteredByType, collections],
  );

  const mediaAssets = useMemo(() => {
    const filtered = filterByText(
      filteredByCollection,
      searchValue,
      (asset) => [asset.name, asset.type],
    );
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => direction * compareByKey(a, b, sort.key, (item) => item.name));
  }, [filteredByCollection, searchValue, sort]);

  function moveAssetToCollection(assetId: Id, collectionId: Id) {
    return collections.assignItem('media_asset', assetId, collectionId);
  }

  return {
    mediaAssets,
    collections,
    searchValue,
    setSearchValue,
    viewMode,
    setViewMode,
    moveAssetToCollection,
  };
}
