import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Id } from '@lumacast/kernel';
import type { ThemeOwnerType } from '@lumacast/composition';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { commitSelectedReorder } from '@lumacast/selection';
import { useThemeEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useMultiSelection, useMultiSelectionKeyHandler, type SelectionModifiers } from '@lumacast/selection';
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
  const { state, actions } = useThemeEditorScreen();
  const { reorderTheme } = useThemeEditor();
  const selection = useMultiSelection(sourceThemes.map(themeId), `theme-editor:${themeType}`);
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  const commitReorder = useCallback(
    (change: SortableOrderCommit) => commitSelectedReorder(change, reorderTheme),
    [reorderTheme],
  );

  const { items: themes, dnd } = useSortableOrder({
    items: sourceThemes as ReturnType<typeof useThemeEditorScreen>['state']['themes'],
    getId: themeId,
    commit: commitReorder,
    selectedIds: selection.selectedIds,
  });

  const handleSelect = useCallback((id: Id, event: ReactMouseEvent<HTMLElement>) => {
    const modifiers: SelectionModifiers = {
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    };
    selection.select(id, modifiers);
    if (!modifiers.shiftKey && !modifiers.metaKey && !modifiers.ctrlKey) actions.selectTheme(themeType, id);
  }, [actions, selection.select, themeType]);

  const handleContextMenu = useCallback((id: Id, event: ReactMouseEvent<HTMLElement>) => {
    const modifiers: SelectionModifiers = {
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    };
    if (modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey) {
      selection.select(id, modifiers);
    } else if (!selection.selectedIds.has(id)) {
      selection.select(id);
      actions.selectTheme(themeType, id);
    }
  }, [actions, selection.select, selection.selectedIds, themeType]);

  return (
    <SortableList.Root {...dnd}>
      <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label={themeType} data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        {themes.map((theme) => (
          <ThemeListItem
            key={theme.id}
            theme={theme}
            isActive={theme.id === state.currentThemeId}
            selection={selection}
            onSelect={(event) => handleSelect(theme.id, event)}
            onContextMenu={(event) => handleContextMenu(theme.id, event)}
          />
        ))}
      </div>
    </SortableList.Root>
  );
}
