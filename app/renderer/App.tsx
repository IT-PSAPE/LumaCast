import { useCast } from './contexts/app-context';
import { AppProvider } from './contexts/app-context';
import { AssetEditorProvider } from './contexts/asset-editor/asset-editor-context';
import { CanvasProvider } from './contexts/canvas/canvas-context';
import { NavigationProvider } from './contexts/navigation-context';
import { PlaybackProvider } from './contexts/playback/playback-context';
import { SlideProvider } from './contexts/slide-context';
import { WorkbenchProvider } from './contexts/workbench-context';
import { CommandPalette } from './features/command-palette/command-palette';
import { CommandPaletteProvider } from './features/command-palette/command-palette-context';
import { BundleDropImport } from './features/deck/bundle-drop-import';
import { CreateDeckItemProvider } from './features/deck/create-deck-item';
import { LyricEditorProvider } from './features/deck/lyric-editor';
import { NdiOutputs } from './features/playback/ndi-outputs';
import { ConfirmProvider } from './components/overlays/confirm-dialog';
import { ErrorBoundary } from './components/feedback/error-boundary';
import { AppToolbar } from './features/workbench/app-toolbar';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { StatusBar } from './features/workbench/status-bar';
import { WindowsInlineMenuBar } from './features/workbench/windows-inline-menu-bar';
import { useAppMenu } from './hooks/use-app-menu';
import { WorkbenchScreenRouter } from './workbench-screen-router';

export function App() {
  return (
    <ErrorBoundary>
      <WorkbenchProvider>
        <ConfirmProvider>
          <AppProvider>
            <NavigationProvider>
              <PlaybackProvider>
                <SlideProvider>
                  <AssetEditorProvider>
                    <LyricEditorProvider>
                      <CreateDeckItemProvider>
                        <CanvasProvider>
                          <CommandPaletteProvider>
                            <NdiOutputs />
                            <SplitPanel>
                              <AppLayoutContent />
                            </SplitPanel>
                            <CommandPalette />
                            <BundleDropImport />
                          </CommandPaletteProvider>
                        </CanvasProvider>
                      </CreateDeckItemProvider>
                    </LyricEditorProvider>
                  </AssetEditorProvider>
                </SlideProvider>
              </PlaybackProvider>
            </NavigationProvider>
          </AppProvider>
        </ConfirmProvider>
      </WorkbenchProvider>
    </ErrorBoundary>
  );
}

function AppLayoutContent() {
  const { snapshot, isLoadingSnapshot, snapshotLoadError, retrySnapshotLoad } = useCast();
  useAppMenu();

  if (isLoadingSnapshot) {
    return (
      <div className="flex items-center justify-center h-full text-secondary">
        Loading LumaCast App
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex max-w-xl flex-col gap-3 rounded-lg border border-secondary bg-secondary/30 p-5 text-left">
          <div className="text-base font-semibold text-primary">LumaCast could not load its project data.</div>
          <div className="text-sm text-secondary">
            {snapshotLoadError ?? 'Unknown startup error.'}
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
    );
  }

  return (
    <div className="relative flex h-screen flex-col">
      <WindowsInlineMenuBar>
        <AppToolbar />
      </WindowsInlineMenuBar>
      <main className="min-h-0 flex-1">
        <WorkbenchScreenRouter />
      </main>
      <StatusBar />
    </div>
  );
}
