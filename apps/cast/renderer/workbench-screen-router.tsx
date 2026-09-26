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

export function WorkbenchScreenRouter() {
  const { state: { workbenchMode } } = useWorkbench();

  useKeyboardShortcuts();

  switch (workbenchMode) {
    case 'show':
      return <ShowScreen />;
    default:
      return (
        <Suspense fallback={null}>
          <EditorScreen mode={workbenchMode} />
        </Suspense>
      );
  }
}

function EditorScreen({ mode }: { mode: EditorWorkbenchMode }) {
  switch (mode) {
    case 'item-editor': return <ItemEditorScreen />;
    case 'overlay-editor': return <OverlayEditorScreen />;
    case 'theme-editor': return <ThemeEditorScreen />;
    case 'stage-editor': return <StageEditorScreen />;
    case 'macro-editor': return <MacroEditorScreen />;
    case 'settings': return <SettingsScreen />;
  }

  return assertNever(mode);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workbench mode: ${String(value)}`);
}
