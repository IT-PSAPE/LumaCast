import { useCallback, useMemo, useState } from 'react';
import type { Theme } from '@lumacast/composition';
import { isThemeCompatibleWithOwnerKind } from '@lumacast/composition';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useNavigation } from '../../../contexts/navigation-context';
import { filterByText } from '../../../utils/filter-by-text';
import { compareByKey, useThemeBinSort } from '../../workbench/use-bin-sort';
import { useBinCollections } from '../../workbench/use-bin-collections';
import type { ResourceDrawerViewMode } from '../../../types/ui';

export function useThemeBin() {
  const { themes, applyThemeToTarget } = useThemeEditor();
  const { currentDeckItem } = useNavigation();
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

  const handleApplyTheme = useCallback(async (theme: Theme) => {
    if (!currentDeckItem) return;
    if (!isThemeCompatibleWithOwnerKind(theme, currentDeckItem.type)) return;
    await applyThemeToTarget(theme.id, { type: 'deck-item', itemId: currentDeckItem.id });
  }, [applyThemeToTarget, currentDeckItem]);

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
