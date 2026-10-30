import type { ThemeOwnerType } from '@lumacast/composition';
import { useConfirm } from '@lumacast/ui';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { GroupedVirtualizedCollection, type GroupedVirtualizedCollectionSection } from '@renderer/components/layout/virtualized-grouped-collection';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useWorkbench } from '../../../contexts/workbench-context';
import { useMultiSelection, type SelectionModifiers } from '@lumacast/selection';
import { CreateThemeDropZone } from './create-theme-drop-zone';
import { ThemeBinItem } from './theme-bin-item';
import { useThemeBin } from './use-theme-bin';
import { runSelectionActions, useMultiSelectionKeyHandler } from '@lumacast/selection';

export function ThemeBinPanel() {
  const { sections, handleApplyTheme } = useThemeBin();
  const { createTheme, deleteTheme, duplicateTheme } = useThemeEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const { state: { viewMode, grid } } = useBinControls();
  const confirm = useConfirm();
  const gridSize = grid?.value ?? 6;
  const lyricSection = sections.find((section) => section.type === 'lyric');
  const presentationSection = sections.find((section) => section.type === 'presentation');
  const lyricSelection = useMultiSelection(lyricSection?.themes.map((theme) => theme.id) ?? [], 'themes:lyric');
  const presentationSelection = useMultiSelection(presentationSection?.themes.map((theme) => theme.id) ?? [], 'themes:presentation');
  const selectedIds = new Set([...lyricSelection.selectedIds, ...presentationSelection.selectedIds]);
  const selectedCount = selectedIds.size;
  const clearSelection = () => {
    lyricSelection.clearSelection();
    presentationSelection.clearSelection();
  };
  const selectAll = () => {
    lyricSelection.selectAll();
    presentationSelection.selectAll();
  };
  const handleSelectionKeys = useMultiSelectionKeyHandler({ selectedCount, selectAll, clearSelection });
  const virtualSections = sections.map<GroupedVirtualizedCollectionSection<(typeof sections)[number]['themes'][number]>>((section) => ({
    key: section.type,
    label: section.label,
    items: section.themes,
  }));

  function handleCreateTheme(themeType: ThemeOwnerType) {
    createTheme(themeType);
    setWorkbenchMode('theme-editor');
  }

  function selectionForType(themeType: ThemeOwnerType) {
    return themeType === 'lyric' ? lyricSelection : presentationSelection;
  }

  function handleSelectionClick(themeType: ThemeOwnerType, id: string, modifiers: SelectionModifiers) {
    const modified = Boolean(modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey);
    if (!modified) clearSelection();
    selectionForType(themeType).select(id, modifiers);
    return modified;
  }

  function handleContextMenuTarget(themeType: ThemeOwnerType, id: string) {
    if (selectedIds.has(id)) return;
    clearSelection();
    selectionForType(themeType).select(id);
  }

  function actionIds(clickedId: string) {
    if (!selectedIds.has(clickedId)) return [clickedId];
    return sections.flatMap((section) => section.themes
      .filter((theme) => selectedIds.has(theme.id))
      .map((theme) => theme.id));
  }

  async function handleDeleteThemes(clickedId: string) {
    const ids = actionIds(clickedId);
    if (ids.length === 0) return;
    const themeNames = new Map(sections.flatMap((section) => section.themes.map((theme) => [theme.id, theme.name] as const)));
    const ok = await confirm({
      title: ids.length === 1 ? `Delete "${themeNames.get(ids[0]) ?? 'theme'}"?` : `Delete ${ids.length} themes?`,
      description: ids.length === 1
        ? 'Slides linked to this theme will be detached.'
        : 'Slides linked to these themes will be detached.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) await runSelectionActions(ids, (id) => deleteTheme(id));
  }

  function handleDuplicateThemes(clickedId: string) {
    void runSelectionActions(actionIds(clickedId), (id) => duplicateTheme(id));
  }

  return (
    <BinShell>
      <BinShell.Content data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        <GroupedVirtualizedCollection
          sections={virtualSections}
          mode={viewMode}
          gridItemSize={gridSize}
          listItemEstimate={40}
          gridRowEstimate={180}
          emptyEstimate={56}
          renderEmptyState={(section) => (
            <CreateThemeDropZone
              themeType={section.key as ThemeOwnerType}
              onActivate={() => handleCreateTheme(section.key as ThemeOwnerType)}
            />
          )}
          getItemKey={(theme) => theme.id}
          renderListItem={(theme, _index, section) => (
            <ThemeBinItem
              key={theme.id}
              theme={theme}
              mode="list"
              themeType={section.key as ThemeOwnerType}
              onApply={handleApplyTheme}
              isResourceSelected={selectedIds.has(theme.id)}
              onSelectionClick={(id, modifiers) => handleSelectionClick(section.key as ThemeOwnerType, id, modifiers)}
              onContextMenuTarget={(id) => handleContextMenuTarget(section.key as ThemeOwnerType, id)}
              onDeleteResource={(selectedTheme) => handleDeleteThemes(selectedTheme.id)}
              onDuplicateResource={(selectedTheme) => handleDuplicateThemes(selectedTheme.id)}
            />
          )}
          renderGridItem={(theme, _index, section) => (
            <ThemeBinItem
              key={theme.id}
              theme={theme}
              mode="grid"
              themeType={section.key as ThemeOwnerType}
              onApply={handleApplyTheme}
              isResourceSelected={selectedIds.has(theme.id)}
              onSelectionClick={(id, modifiers) => handleSelectionClick(section.key as ThemeOwnerType, id, modifiers)}
              onContextMenuTarget={(id) => handleContextMenuTarget(section.key as ThemeOwnerType, id)}
              onDeleteResource={(selectedTheme) => handleDeleteThemes(selectedTheme.id)}
              onDuplicateResource={(selectedTheme) => handleDuplicateThemes(selectedTheme.id)}
            />
          )}
        />
      </BinShell.Content>
    </BinShell>
  );
}
