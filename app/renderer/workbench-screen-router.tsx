import { lazy, Suspense } from 'react';
import { useWorkbench } from './contexts/workbench-context';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';
import type { WorkbenchMode } from './types/ui';

// Show screen is the most common landing surface — keep it eagerly loaded so
// cold open lands on a visible UI without a Suspense flash.
import { ShowScreen } from './screens/show/page';

// Editors and settings are heavyweight (Konva, big inspectors, asset editors)
// and only ever entered from a menu/command. Code-splitting them keeps the
// initial renderer bundle small.
const ItemEditorScreen = lazy(() =>
  import('./screens/item-editor/page').then((m) => ({ default: m.ItemEditorScreen })),
);
const OverlayEditorScreen = lazy(() =>
  import('./screens/overlay-editor/page').then((m) => ({ default: m.OverlayEditorScreen })),
);
const ThemeEditorScreen = lazy(() =>
  import('./screens/theme-editor/page').then((m) => ({ default: m.ThemeEditorScreen })),
);
const StageEditorScreen = lazy(() =>
  import('./screens/stage-editor/page').then((m) => ({ default: m.StageEditorScreen })),
);
const MacroEditorScreen = lazy(() =>
  import('./screens/macro-editor/page').then((m) => ({ default: m.MacroEditorScreen })),
);
const SettingsScreen = lazy(() =>
  import('./screens/settings/page').then((m) => ({ default: m.SettingsScreen })),
);

type EditorWorkbenchMode = Exclude<WorkbenchMode, 'show'>;

// Exhaustive by construction: a new WorkbenchMode value must be mapped here
// before it can render, so an unhandled mode is a compile error instead of a
// blank shell. Every editor screen is a zero-prop lazy component, so they
// share the ItemEditorScreen's component type.
const EDITOR_SCREENS: Record<EditorWorkbenchMode, typeof ItemEditorScreen> = {
  'item-editor': ItemEditorScreen,
  'overlay-editor': OverlayEditorScreen,
  'theme-editor': ThemeEditorScreen,
  'stage-editor': StageEditorScreen,
  'macro-editor': MacroEditorScreen,
  settings: SettingsScreen,
};

export function WorkbenchScreenRouter() {
  const { state: { workbenchMode } } = useWorkbench();

  useKeyboardShortcuts();

  if (workbenchMode === 'show') {
    return <ShowScreen />;
  }

  const Screen = EDITOR_SCREENS[workbenchMode];

  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  );
}
