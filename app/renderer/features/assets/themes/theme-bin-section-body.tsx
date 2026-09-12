import type { EditorThemeSource } from '@lumacast/canvas';
import { Label } from '../../../components/display/text';
import type { ResourceDrawerViewMode } from '../../../types/ui';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { CreateThemeDropZone } from './create-theme-drop-zone';
import { ThemeBinItem } from './theme-bin-item';
import type { ThemeBinSection } from './use-theme-bin';

interface ThemeBinSectionBodyProps {
  section: ThemeBinSection;
  gridSize: number;
  viewMode: ResourceDrawerViewMode;
  onCreate: () => void;
  onApply: (theme: EditorThemeSource) => void;
}

export function ThemeBinSectionBody({ section, gridSize, viewMode, onCreate, onApply }: ThemeBinSectionBodyProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label.xs className="px-1 text-tertiary">{section.label}</Label.xs>
      {section.themes.length === 0 ? (
        <CreateThemeDropZone themeType={section.type} onActivate={onCreate} />
      ) : (
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
          {section.themes.map((theme, index) => (
            <ThemeBinItem
              key={theme.id}
              theme={theme}
              index={index}
              mode={viewMode}
              themeType={section.type}
              onApply={onApply}
            />
          ))}
        </BinPanelLayout>
      )}
    </div>
  );
}
