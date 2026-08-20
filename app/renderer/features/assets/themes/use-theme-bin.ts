import { useCallback, useMemo } from 'react';
import type { EditorThemeSource } from '@lumacast/canvas';
import type { ThemeOwnerType } from '@lumacast/composition';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useNavigation } from '../../../contexts/navigation-context';
import { filterByText } from '../../../utils/filter-by-text';
import { compareByKey, useThemeBinSort, type BinSort, type BinTabSortKey } from '../../workbench/use-bin-sort';
import { useBinControls } from '@renderer/components/controls/bin-controls';

export interface ThemeBinSection {
  type: ThemeOwnerType;
  label: string;
  themes: EditorThemeSource[];
}

// Section order and labels match THEME_OWNER_TYPES: Presentations, Lyrics,
// Talks, Overlays. Every family renders its own section regardless of the
// search filter — a family whose themes all filter out still shows its
// section, emptied.
const THEME_SECTIONS: ReadonlyArray<{ type: ThemeOwnerType; label: string }> = [
  { type: 'presentation', label: 'Presentations' },
  { type: 'lyric', label: 'Lyrics' },
  { type: 'talk', label: 'Talks' },
  { type: 'overlay', label: 'Overlays' },
];

// #219 item-model refactor decision D2: theme/item compatibility is now
// structural — a theme applied via the bin's quick-apply click only ever
// targets the current item when its type matches the family of the section
// the clicked theme lives in. Because the bin renders every family at once,
// the owning family is resolved from the theme id (ids are unique across
// families), never from a single active family.
export function useThemeBin() {
  const { themesByType, applyThemeToTarget } = useThemeEditor();
  const { currentItemRef } = useNavigation();
  const { sort } = useThemeBinSort();
  const { state: { searchValue } } = useBinControls();

  const sections = useMemo<ThemeBinSection[]>(() => (
    THEME_SECTIONS.map(({ type, label }) => ({
      type,
      label,
      themes: filterAndSortThemes(themesByType[type], searchValue, sort),
    }))
  ), [searchValue, sort, themesByType]);

  const handleApplyTheme = useCallback(async (theme: EditorThemeSource) => {
    const owningType = THEME_SECTIONS.find(({ type }) => themesByType[type].some((t) => t.id === theme.id))?.type;
    if (!owningType || !currentItemRef || currentItemRef.type !== owningType) return;
    await applyThemeToTarget(theme.id, { type: 'item', itemRef: currentItemRef });
  }, [applyThemeToTarget, currentItemRef, themesByType]);

  return {
    sections,
    handleApplyTheme,
  };
}

function filterAndSortThemes(
  themes: EditorThemeSource[],
  searchValue: string,
  sort: BinSort<BinTabSortKey>,
): EditorThemeSource[] {
  const filtered = filterByText(themes, searchValue, (t) => [t.name]);
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => direction * compareByKey(a, b, sort.key, (item) => item.name));
}