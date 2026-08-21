import { AppProvider } from './contexts/app-context';
import { AssetEditorProvider } from './contexts/asset-editor/asset-editor-context';
import { CanvasProvider } from './contexts/canvas/canvas-context';
import { NavigationProvider } from './contexts/navigation-context';
import { PlaybackProvider } from './contexts/playback/playback-context';
import { SlideProvider } from './contexts/slide-context';
import { WorkbenchProvider } from './contexts/workbench-context';
import { CommandPalette } from './features/command-palette/command-palette';
import { CommandPaletteProvider } from './features/command-palette/command-palette-context';
import { BundleDropImport } from './features/items/bundle-drop-import';
import { CreateItemProvider } from './features/items/create-item';
import { LyricEditorProvider } from './features/items/lyric-editor';
import { AutomationProvider } from './features/automation/automation-context';
import { NdiOutputs } from './features/playback/ndi-outputs';
import { ConfirmProvider } from './components/overlays/confirm-dialog';
import { ErrorBoundary } from './components/feedback/error-boundary';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { AppLayoutContent } from './app-layout-content';

export function App() {
  return (
    <ErrorBoundary>
      <WorkbenchProvider>
        <ConfirmProvider>
          <AppProvider>
            <AssetEditorProvider>
              <NavigationProvider>
                <PlaybackProvider>
                  <SlideProvider>
                    <AutomationProvider>
                      <LyricEditorProvider>
                        <CreateItemProvider>
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
                        </CreateItemProvider>
                      </LyricEditorProvider>
                    </AutomationProvider>
                  </SlideProvider>
                </PlaybackProvider>
              </NavigationProvider>
            </AssetEditorProvider>
          </AppProvider>
        </ConfirmProvider>
      </WorkbenchProvider>
    </ErrorBoundary>
  );
}
