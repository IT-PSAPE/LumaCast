import type { ThemeOwnerType } from '@lumacast/composition';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { useThemeEditor } from '../../../contexts/asset-editor/asset-editor-context';
import { useWorkbench } from '../../../contexts/workbench-context';
import { useThemeBin } from './use-theme-bin';
import { ThemeBinSectionBody } from './theme-bin-section-body';

export function ThemeBinPanel() {
  const { sections, handleApplyTheme } = useThemeBin();
  const { createTheme } = useThemeEditor();
  const { actions: { setWorkbenchMode } } = useWorkbench();
  const { state: { viewMode, grid } } = useBinControls();
  const gridSize = grid?.value ?? 6;

  function handleCreateTheme(themeType: ThemeOwnerType) {
    createTheme(themeType);
    setWorkbenchMode('theme-editor');
  }

  return (
    <BinShell>
      <BinShell.Content>
        <div className="flex flex-col gap-3">
          {sections.map((section) => (
            <ThemeBinSectionBody
              key={section.type}
              section={section}
              gridSize={gridSize}
              viewMode={viewMode}
              onCreate={() => handleCreateTheme(section.type)}
              onApply={handleApplyTheme}
            />
          ))}
        </div>
      </BinShell.Content>
    </BinShell>
  );
}
