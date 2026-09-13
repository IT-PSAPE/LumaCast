import type { ThemeOwnerType } from '@lumacast/composition';
import { Plus } from 'lucide-react';
import { Label } from '@renderer/components/display/text';
import { useThemeEditorScreen } from './screen-context';
import { ThemeFamilyList } from './theme-family-list';

type VisibleThemeOwnerType = Exclude<ThemeOwnerType, 'overlay'>;

export function ThemeFamilySection({ themeType }: { themeType: VisibleThemeOwnerType }) {
  switch (themeType) {
    case 'presentation':
      return <ThemeFamily themeType="presentation" heading="Presentations" createLabel="presentation" />;
    case 'lyric':
      return <ThemeFamily themeType="lyric" heading="Lyrics" createLabel="lyric" />;
  }

  return assertNever(themeType);
}

function ThemeFamily({ themeType, heading, createLabel }: {
  themeType: VisibleThemeOwnerType;
  heading: string;
  createLabel: string;
}) {
  const { state, actions } = useThemeEditorScreen();
  const themes = state.themesByType[themeType];

  return (
    <div className="flex flex-col gap-1.5">
      <Label.xs className="px-1 text-tertiary">{heading}</Label.xs>
      {themes.length === 0 ? (
        <button
          type="button"
          onClick={() => actions.createTheme(themeType)}
          aria-label={`Create ${createLabel} theme`}
          className="flex w-full items-center justify-center gap-1.5 rounded-xs border border-dashed border-tertiary/70 px-2 py-2.5 text-tertiary transition-colors hover:border-secondary hover:text-secondary focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden />
          <span className="text-xs">Create {createLabel} theme</span>
        </button>
      ) : (
        <ThemeFamilyList themeType={themeType} themes={themes} />
      )}
    </div>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled visible theme owner: ${String(value)}`);
}
