import { useMemo, useState } from 'react';
import { useAudio } from '../../../contexts/playback/playback-context';
import { filterByText } from '../../../utils/filter-by-text';
import { compareByKey, useAudioBinSort } from '../../workbench/use-bin-sort';
import { useBinCollections } from '../../workbench/use-bin-collections';
import type { ResourceDrawerViewMode } from '../../../types/ui';

export function useAudioBin() {
  const { audioAssets: allAudioAssets, currentAudioAssetId, armAudio } = useAudio();
  const { sort } = useAudioBinSort();
  const collections = useBinCollections('audio');
  const [searchValue, setSearchValue] = useState('');
  const [viewMode, setViewMode] = useState<ResourceDrawerViewMode>('list');

  const filteredByCollection = useMemo(
    () => collections.filterByActiveCollection(allAudioAssets),
    [allAudioAssets, collections],
  );

  const audioAssets = useMemo(() => {
    const filtered = filterByText(filteredByCollection, searchValue, (asset) => [asset.name]);
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => direction * compareByKey(a, b, sort.key, (item) => item.name));
  }, [filteredByCollection, searchValue, sort]);

  return {
    audioAssets,
    currentAudioAssetId,
    armAudio,
    collections,
    searchValue,
    setSearchValue,
    viewMode,
    setViewMode,
  };
}
