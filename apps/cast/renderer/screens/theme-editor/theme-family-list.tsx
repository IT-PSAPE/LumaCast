import { useCallback } from 'react';
import type { ThemeOwnerType } from '@lumacast/composition';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { useThemeEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useThemeEditorScreen } from './screen-context';
import { ThemeListItem } from './theme-list-item';

const themeId = (theme: ReturnType<typeof useThemeEditorScreen>['state']['themes'][number]) => theme.id;

export function ThemeFamilyList({
  themeType,
  themes: sourceThemes,
}: {
  themeType: ThemeOwnerType;
  themes: ReturnType<typeof useThemeEditorScreen>['state']['themesByType'][ThemeOwnerType];
}) {
  const { state } = useThemeEditorScreen();
  const { reorderTheme } = useThemeEditor();

  const commitReorder = useCallback(
    ({ id, toIndex }: SortableOrderCommit) => reorderTheme(id, toIndex),
    [reorderTheme],
  );

  const { items: themes, dnd } = useSortableOrder({
    items: sourceThemes as ReturnType<typeof useThemeEditorScreen>['state']['themes'],
    getId: themeId,
    commit: commitReorder,
  });

  return (
    <SortableList.Root {...dnd}>
      <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label={themeType}>
        {themes.map((theme, index) => (
          <ThemeListItem key={theme.id} theme={theme} themeType={themeType} index={index} isActive={theme.id === state.currentThemeId} />
        ))}
      </div>
    </SortableList.Root>
  );
}
