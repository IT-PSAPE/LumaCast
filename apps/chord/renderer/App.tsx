// The app root: follows the system theme, installs the menu-command bridge,
// picks Welcome vs. the full Workspace, and mounts the two singleton
// overlay hosts (toasts, the imperative confirm dialog) exactly once.
import { Toaster } from '@lumacast/ui';
import { getApi } from './api';
import { ConfirmHost } from './components/confirm-dialog';
import { TitleBar } from './features/shell/title-bar';
import { Welcome } from './features/shell/welcome';
import { Workspace } from './features/shell/workspace';
import { useMenuCommands } from './features/shell/menu-commands';
import { useDebouncedEffect } from './hooks/use-debounced-effect';
import { useSystemThemeAttribute } from './hooks/use-system-theme';
import { useChordStore } from './store';

export function App() {
  useSystemThemeAttribute();
  useMenuCommands();

  const title = useChordStore((s) => s.document.project.title);
  const path = useChordStore((s) => s.document.path);
  const dirty = useChordStore((s) => s.dirty);
  const cueCount = useChordStore((s) => s.document.project.cues.length);
  const hasAudio = useChordStore((s) => s.document.project.audio !== null);

  useDebouncedEffect(() => {
    void getApi().setDocumentState({ title, path, dirty });
  }, [title, path, dirty], 300);

  const isUntitledAndEmpty = path === null && title === 'Untitled' && cueCount === 0 && !hasAudio;

  return (
    <div className="flex h-full flex-col bg-primary text-primary">
      <TitleBar />
      {isUntitledAndEmpty ? <Welcome /> : <Workspace />}
      <Toaster />
      <ConfirmHost />
    </div>
  );
}
