import { useCast } from './contexts/app-context';
import { useAppMenu } from './hooks/use-app-menu';
import { AppToolbar } from './features/workbench/app-toolbar';
import { StatusBar } from './features/workbench/status-bar';
import { WindowsInlineMenuBar } from './features/workbench/windows-inline-menu-bar';
import { WorkbenchScreenRouter } from './workbench-screen-router';

export function AppLayoutContent() {
  const { snapshot, isLoadingSnapshot, snapshotLoadError, retrySnapshotLoad } = useCast();
  useAppMenu();

  return (
    <div className="relative flex h-screen flex-col">
      <WindowsInlineMenuBar>
        <AppToolbar />
      </WindowsInlineMenuBar>
      <main className="min-h-0 flex-1">
        {snapshot ? (
          <WorkbenchScreenRouter />
        ) : snapshotLoadError && !isLoadingSnapshot ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="flex max-w-xl flex-col gap-3 rounded-lg border border-secondary bg-secondary/30 p-5 text-left">
              <div className="text-base font-semibold text-primary">LumaCast could not load its project data.</div>
              <div className="text-sm text-secondary">
                {snapshotLoadError}
              </div>
              <div className="text-xs text-tertiary">
                This often points to a corrupted or incompatible local database on this machine.
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => { void retrySnapshotLoad(); }}
                  className="rounded-sm bg-brand_solid px-3 py-1.5 text-sm font-medium text-primary transition-opacity hover:opacity-90"
                >
                  Retry startup
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-secondary">
            Loading LumaCast App
          </div>
        )}
      </main>
      <StatusBar />
    </div>
  );
}
