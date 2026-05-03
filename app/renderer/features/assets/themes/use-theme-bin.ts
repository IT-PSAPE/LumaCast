import { useCallback, useMemo, useState } from 'react';
import type { Theme } from '@core/types';
import { isThemeCompatibleWithDeckItem } from '@core/themes';
import { useCast } from '../../../contexts/app-context';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useNavigation } from '../../../contexts/navigation-context';
import { filterByText } from '../../../utils/filter-by-text';
import { compareByKey, useThemeBinSort } from '../../workbench/use-bin-sort';
import { useBinCollections } from '../../workbench/use-bin-collections';
import type { ResourceDrawerViewMode } from '../../../types/ui';

export function useThemeBin() {
  const { themes } = useThemeEditor();
  const { currentDeckItem } = useNavigation();
  const { mutatePatch } = useCast();
  const { sort } = useThemeBinSort();
  const collections = useBinCollections('theme');
  const [searchValue, setSearchValue] = useState('');
  const [viewMode, setViewMode] = useState<ResourceDrawerViewMode>('grid');

  const filteredByCollection = useMemo(
    () => collections.filterByActiveCollection(themes),
    [themes, collections],
  );

  const filteredThemes = useMemo(() => {
    const filtered = filterByText(filteredByCollection, searchValue, (t) => [t.name, t.kind]);
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => direction * compareByKey(a, b, sort.key, (item) => item.name));
  }, [filteredByCollection, searchValue, sort]);

  const handleApplyTheme = useCallback((theme: Theme) => {
    if (!currentDeckItem) return;
    if (!isThemeCompatibleWithDeckItem(theme, currentDeckItem.type)) return;
    void mutatePatch(() => window.castApi.applyThemeToDeckItem(theme.id, currentDeckItem.id));
  }, [currentDeckItem, mutatePatch]);

  return {
    filteredThemes,
    handleApplyTheme,
    collections,
    searchValue,
    setSearchValue,
    viewMode,
    setViewMode,
  };
}
