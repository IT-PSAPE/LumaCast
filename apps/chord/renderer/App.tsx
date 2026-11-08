// The app root: follows the system theme, installs the menu-command bridge,
// always renders the Workspace (an empty untitled project opens straight
// into the editor), and mounts the two singleton
// overlay hosts (toasts, the imperative confirm dialog) exactly once.
import { Toaster } from '@lumacast/ui';
import { getApi } from './api';
import { ConfirmHost } from './components/confirm-dialog';
import { ShellStatusBar } from './shell/status-bar';
import { TitleBar } from './shell/title-bar';
import { Workspace } from './shell/workspace';
import { useMenuCommands } from './shell/menu-commands';
import { useDebouncedEffect } from './hooks/use-debounced-effect';
import { useSystemThemeAttribute } from './hooks/use-system-theme';
import { useChordStore } from './store';

export function App() {
  useSystemThemeAttribute();
  useMenuCommands();

  const title = useChordStore((s) => s.document.project.title);
  const path = useChordStore((s) => s.document.path);
  const dirty = useChordStore((s) => s.dirty);

  useDebouncedEffect(() => {
    void getApi().setDocumentState({ title, path, dirty });
  }, [title, path, dirty], 300);

  return (
    <div className="flex h-full flex-col bg-primary text-primary">
      <TitleBar />
      <Workspace />
      <ShellStatusBar />
      <Toaster />
      <ConfirmHost />
    </div>
  );
}
