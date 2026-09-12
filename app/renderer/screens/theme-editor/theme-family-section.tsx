import type { ThemeOwnerType } from '@lumacast/composition';
import { Plus } from 'lucide-react';
import { Label } from '@renderer/components/display/text';
import { useThemeEditorScreen } from './screen-context';
import { ThemeFamilyList } from './theme-family-list';
import { singular } from './theme-sections';

export function ThemeFamilySection({ themeType, label }: { themeType: ThemeOwnerType; label: string }) {
  const { state, actions } = useThemeEditorScreen();
  const themes = state.themesByType[themeType];

  return (
    <div className="flex flex-col gap-1.5">
      <Label.xs className="px-1 text-tertiary">{label}</Label.xs>
      {themes.length === 0 ? (
        <button
          type="button"
          onClick={() => actions.createTheme(themeType)}
          aria-label={`Create ${singular(label)} theme`}
          className="flex w-full items-center justify-center gap-1.5 rounded-xs border border-dashed border-tertiary/70 px-2 py-2.5 text-tertiary transition-colors hover:border-secondary hover:text-secondary focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden />
          <span className="text-xs">Create {singular(label)} theme</span>
        </button>
      ) : (
        <ThemeFamilyList themeType={themeType} themes={themes} />
      )}
    </div>
  );
}
