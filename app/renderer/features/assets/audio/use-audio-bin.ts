import { useMemo } from 'react';
import { useAudio } from '../../../contexts/playback/playback-context';
import { filterByText } from '../../../utils/filter-by-text';
import { compareByKey, useAudioBinSort } from '../../workbench/use-bin-sort';
import { useBinControls } from '@renderer/components/controls/bin-controls';

export function useAudioBin() {
  const { audioAssets: allAudioAssets, currentAudioAssetId, armAudio } = useAudio();
  const { sort } = useAudioBinSort();
  const { state: { searchValue } } = useBinControls();

  const audioAssets = useMemo(() => {
    const filtered = filterByText(allAudioAssets, searchValue, (asset) => [asset.name]);
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => direction * compareByKey(a, b, sort.key, (item) => item.name));
  }, [allAudioAssets, searchValue, sort]);

  return {
    audioAssets,
    currentAudioAssetId,
    armAudio,
  };
}
