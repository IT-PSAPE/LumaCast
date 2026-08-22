import type { ThemeOwnerType } from '@lumacast/composition';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { GroupedVirtualizedCollection, type GroupedVirtualizedCollectionSection } from '@renderer/components/layout/virtualized-grouped-collection';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useWorkbench } from '../../../contexts/workbench-context';
import { CreateThemeDropZone } from './create-theme-drop-zone';
import { ThemeBinItem } from './theme-bin-item';
import { useThemeBin } from './use-theme-bin';

export function ThemeBinPanel() {
  const { sections, handleApplyTheme } = useThemeBin();
  const { createTheme } = useThemeEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const { state: { viewMode, grid } } = useBinControls();
  const gridSize = grid?.value ?? 6;
  const virtualSections = sections.map<GroupedVirtualizedCollectionSection<(typeof sections)[number]['themes'][number]>>((section) => ({
    key: section.type,
    label: section.label,
    items: section.themes,
    emptyState: <CreateThemeDropZone themeType={section.type} onActivate={() => handleCreateTheme(section.type)} />,
  }));

  function handleCreateTheme(themeType: ThemeOwnerType) {
    createTheme(themeType);
    setWorkbenchMode('theme-editor');
  }

  return (
    <BinShell>
      <BinShell.Content>
        <GroupedVirtualizedCollection
          sections={virtualSections}
          mode={viewMode}
          gridItemSize={gridSize}
          listItemEstimate={40}
          gridRowEstimate={180}
          emptyEstimate={56}
          getItemKey={(theme) => theme.id}
          renderListItem={(theme, index, section) => (
            <ThemeBinItem
              key={theme.id}
              theme={theme}
              index={index}
              mode="list"
              themeType={section.key as ThemeOwnerType}
              onApply={handleApplyTheme}
            />
          )}
          renderGridItem={(theme, index, section) => (
            <ThemeBinItem
              key={theme.id}
              theme={theme}
              index={index}
              mode="grid"
              themeType={section.key as ThemeOwnerType}
              onApply={handleApplyTheme}
            />
          )}
        />
      </BinShell.Content>
    </BinShell>
  );
}
