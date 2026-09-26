import { useEffect } from 'react';
import { AppProvider } from './contexts/app-context';
import { AssetEditorProvider } from './contexts/asset-editor/asset-editor-context';
import { CanvasProvider } from './contexts/canvas/canvas-context';
import { NavigationProvider } from './contexts/navigation-context';
import { PlaybackProvider } from './contexts/playback/playback-context';
import { PlaybackSchedulesProvider } from './contexts/playback-schedules-context';
import { SlideProvider } from './contexts/slide-context';
import { TimersProvider } from './contexts/timers/timers-context';
import { WorkbenchProvider } from './contexts/workbench-context';
import { AgentActionDispatcher } from './features/agent/agent-action-dispatcher';
import { AgentChatProvider } from './features/agent/chat/agent-chat-context';
import { AgentChatPopup } from './features/agent/chat/agent-chat-popup';
import { CommandPalette } from './features/command-palette/command-palette';
import { CommandPaletteProvider } from './features/command-palette/command-palette-context';
import { CreateItemProvider } from './features/items/create-item';
import { LyricEditorProvider } from './features/items/lyric-editor';
import { AutomationProvider } from './features/automation/automation-context';
import { NdiOutputsGate } from './features/playback/ndi-outputs-gate';
import { MediaResidencyBoundary } from './features/playback/media-residency-boundary';
import { SlideRenderHost } from './features/render/slide-render-host';
import { useObservabilityRuntime } from './features/observability/observability-runtime';
import { ConfirmProvider } from './components/overlays/confirm-dialog';
import { ErrorBoundary } from './components/feedback/error-boundary';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { AppLayoutContent } from './app-layout-content';

function ObservabilityRuntime() {
  useObservabilityRuntime();
  return null;
}

// Navigation safety only: dropping a file outside a scoped drop zone (media
// bins, upload dialogs) must not navigate the window to the file. This guard
// claims nothing, shows no overlay, and imports nothing — bundle import stays
// on the click-driven "Choose bundle…" picker in the import/export panel.
export function FileDropNavigationGuard() {
  useEffect(() => {
    function handleDragOver(event: DragEvent) {
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault();
    }

    function handleDrop(event: DragEvent) {
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault();
    }

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <WorkbenchProvider>
        <ObservabilityRuntime />
        <ConfirmProvider>
          <AgentChatProvider>
            <AppProvider>
              <TimersProvider>
                <AssetEditorProvider>
                  <NavigationProvider>
                    <PlaybackProvider>
                      <SlideProvider>
                        <PlaybackSchedulesProvider>
                          <MediaResidencyBoundary>
                            <AutomationProvider>
                              <LyricEditorProvider>
                                <CreateItemProvider>
                                  <CanvasProvider>
                                    <CommandPaletteProvider>
                                      <NdiOutputsGate />
                                      <SplitPanel>
                                        <AppLayoutContent />
                                        {/* Inside SplitPanel so workbench.togglePanel can reach the
                                            panel-route context; every other provider it needs is above. */}
                                        <AgentActionDispatcher />
                                      </SplitPanel>
                                      <CommandPalette />
                                      <FileDropNavigationGuard />
                                      <SlideRenderHost />
                                      <AgentChatPopup.Root />
                                    </CommandPaletteProvider>
                                  </CanvasProvider>
                                </CreateItemProvider>
                              </LyricEditorProvider>
                            </AutomationProvider>
                          </MediaResidencyBoundary>
                        </PlaybackSchedulesProvider>
                      </SlideProvider>
                    </PlaybackProvider>
                  </NavigationProvider>
                </AssetEditorProvider>
              </TimersProvider>
            </AppProvider>
          </AgentChatProvider>
        </ConfirmProvider>
      </WorkbenchProvider>
    </ErrorBoundary>
  );
}
