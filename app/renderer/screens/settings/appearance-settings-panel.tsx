import { useTheme } from '../../contexts/app-context';
import { SegmentedControl } from '@renderer/components/controls/segmented-control';
import type { ThemeMode } from '../../types/ui';

export function AppearanceSettingsPanel() {
  const { state: { themeMode }, actions: { setThemeMode } } = useTheme();
  function handleThemeModeChange(value: string | string[]) {
    if (Array.isArray(value)) return;
    if (value === 'light' || value === 'dark' || value === 'system') {
      setThemeMode(value);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-b border-primary pb-5 last:border-b-0 last:pb-0">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-primary">Theme</h2>
      </header>
      <div className="flex flex-col gap-2">
        <SegmentedControl value={themeMode} onValueChange={handleThemeModeChange} aria-label="Theme mode">
          <SegmentedControl.Label value={'light' satisfies ThemeMode}>Light</SegmentedControl.Label>
          <SegmentedControl.Label value={'dark' satisfies ThemeMode}>Dark</SegmentedControl.Label>
          <SegmentedControl.Label value={'system' satisfies ThemeMode}>System</SegmentedControl.Label>
        </SegmentedControl>
      </div>
    </section>
  );
}
