import { useCallback, useMemo, useState } from 'react';
import type { EditorThemeSource } from '@lumacast/canvas';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useNavigation } from '../../../contexts/navigation-context';
import { filterByText } from '../../../utils/filter-by-text';
import { compareByKey, useThemeBinSort } from '../../workbench/use-bin-sort';
import type { ResourceDrawerViewMode } from '../../../types/ui';

// #219 item-model refactor decision D2: theme/item compatibility is now
// structural — a theme applied via the bin's quick-apply click only ever
// targets the current item when its type matches the bin's active theme
// family, so there is no compatibility matrix to consult here.
export function useThemeBin() {
  const { themeType, setThemeType, themes, applyThemeToTarget } = useThemeEditor();
  const { currentItemRef } = useNavigation();
  const { sort } = useThemeBinSort();
  const [searchValue, setSearchValue] = useState('');
  const [viewMode, setViewMode] = useState<ResourceDrawerViewMode>('grid');

  const filteredThemes = useMemo(() => {
    const filtered = filterByText(themes, searchValue, (t) => [t.name]);
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => direction * compareByKey(a, b, sort.key, (item) => item.name));
  }, [themes, searchValue, sort]);

  const handleApplyTheme = useCallback(async (theme: EditorThemeSource) => {
    if (!currentItemRef || currentItemRef.type !== themeType) return;
    await applyThemeToTarget(theme.id, { type: 'item', itemRef: currentItemRef });
  }, [applyThemeToTarget, currentItemRef, themeType]);

  return {
    themeType,
    setThemeType,
    filteredThemes,
    handleApplyTheme,
    searchValue,
    setSearchValue,
    viewMode,
    setViewMode,
  };
}
