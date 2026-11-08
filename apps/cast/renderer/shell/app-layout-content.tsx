import { useCast } from '../contexts/app-context';
import { useAppMenu } from '../application/use-app-menu';
import { AppToolbar } from '../features/workbench';
import { useCommandPalette } from '../contexts/command-palette-context';
import { StatusBar } from './status-bar';
import { WorkbenchScreenRouter } from '../workbench-screen-router';
import { ReacstButton } from '@lumacast/ui';

export function AppLayoutContent() {
  const { snapshot, isLoadingSnapshot, snapshotLoadError, retrySnapshotLoad } = useCast();
  const { open: openCommandPalette } = useCommandPalette();
  useAppMenu();

  return (
    <div className="relative flex h-screen flex-col">
      <AppToolbar onOpenCommandPalette={openCommandPalette} />
      <main className="min-h-0 flex-1">
        {snapshot ? (
          <WorkbenchScreenRouter />
        ) : snapshotLoadError && !isLoadingSnapshot ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="flex max-w-xl flex-col gap-3 rounded-container border border-secondary bg-secondary/30 p-5 text-left">
              <div className="text-base font-semibold text-primary">LumaCast could not load its project data.</div>
              <div className="text-sm text-secondary">
                {snapshotLoadError}
              </div>
              <div className="text-xs text-tertiary">
                This often points to a corrupted or incompatible local database on this machine.
              </div>
              <div>
                <ReacstButton
                  variant="primary"
                  onClick={() => { void retrySnapshotLoad(); }}
                  className="text-sm"
                >
                  Retry startup
                </ReacstButton>
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
