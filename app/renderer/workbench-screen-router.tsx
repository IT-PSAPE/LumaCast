import { lazy, Suspense } from 'react';
import { useWorkbench } from './contexts/workbench-context';
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts';

// Show screen is the most common landing surface — keep it eagerly loaded so
// cold open lands on a visible UI without a Suspense flash.
import { ShowScreen } from './screens/show/page';

// Editors and settings are heavyweight (Konva, big inspectors, asset editors)
// and only ever entered from a menu/command. Code-splitting them keeps the
// initial renderer bundle small.
const DeckEditorScreen = lazy(() =>
  import('./screens/deck-editor/page').then((m) => ({ default: m.DeckEditorScreen })),
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

export function WorkbenchScreenRouter() {
  const { state: { workbenchMode } } = useWorkbench();

  useKeyboardShortcuts();

  if (workbenchMode === 'show') {
    return <ShowScreen />;
  }

  return (
    <Suspense fallback={null}>
      {workbenchMode === 'deck-editor' ? <DeckEditorScreen /> : null}
      {workbenchMode === 'overlay-editor' ? <OverlayEditorScreen /> : null}
      {workbenchMode === 'theme-editor' ? <ThemeEditorScreen /> : null}
      {workbenchMode === 'stage-editor' ? <StageEditorScreen /> : null}
      {workbenchMode === 'macro-editor' ? <MacroEditorScreen /> : null}
      {workbenchMode === 'settings' ? <SettingsScreen /> : null}
    </Suspense>
  );
}
