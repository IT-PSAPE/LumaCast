import { useEffect } from 'react';
import { ReacstButton, Tabs } from '@lumacast/ui';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { ShapeElementInspector } from '@renderer/features/inspector/shape-element-inspector';
import { ThemeInspector } from '@renderer/features/inspector/theme-inspector';
import { TextElementInspector } from '@renderer/features/inspector/text-element-inspector';
import { VideoElementInspector } from '@renderer/features/inspector/video-element-inspector';
import type { InspectorTab } from '@renderer/types/ui';
import { useThemeEditorScreen } from './screen-context';

export function ThemeEditorInspectorPanel() {
  const { state, actions } = useThemeEditorScreen();
  const { inspectorTab, setInspectorTab } = useInspector();
  const { selectedElement } = useElements();
  const hasSelection = Boolean(selectedElement);
  const isTextSelected = selectedElement?.type === 'text';
  const isVideoSelected = selectedElement?.type === 'video';

  useEffect(() => {
    if (!hasSelection) {
      // No selection → only the theme tab is rendered; force it so we don't
      // strand on a foreign editor's tab (e.g. 'stage' or 'slide') leaving
      // the panel blank when navigating between editors.
      if (inspectorTab !== 'theme') setInspectorTab('theme');
      return;
    }

    if (isTextSelected) {
      if (inspectorTab !== 'shape' && inspectorTab !== 'text') setInspectorTab('shape');
      return;
    }

    if (isVideoSelected) {
      if (inspectorTab !== 'shape' && inspectorTab !== 'video') setInspectorTab('video');
      return;
    }

    if (inspectorTab !== 'shape') setInspectorTab('shape');
  }, [hasSelection, inspectorTab, isTextSelected, isVideoSelected, setInspectorTab]);

  function handleTabChange(value: string) {
    setInspectorTab(value as InspectorTab);
  }

  return (
    <LumaCastPanel.Root className="h-full border-l border-secondary" data-ui-region="inspector-panel">
      <Tabs value={inspectorTab} variant="plain" className="contents" onValueChange={handleTabChange}>
        <section className="flex flex-1 flex-col">
          <div className="border-b border-primary">
            <Tabs.List aria-label="Inspector" className="min-w-0 overflow-x-auto [&>*]:shrink-0">
              {!hasSelection && <Tabs.Tab value="theme">Theme</Tabs.Tab>}
              {hasSelection && <Tabs.Tab value="shape">Shape</Tabs.Tab>}
              {isTextSelected && <Tabs.Tab value="text">Text</Tabs.Tab>}
              {isVideoSelected && <Tabs.Tab value="video">Video</Tabs.Tab>}
            </Tabs.List>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {inspectorTab === 'theme' && <ThemeInspector />}
            {inspectorTab === 'shape' && <ShapeElementInspector />}
            {inspectorTab === 'text' && <TextElementInspector />}
            {inspectorTab === 'video' && <VideoElementInspector />}
          </div>
        </section>
      </Tabs>
      {state.currentTheme && (
        <LumaCastPanel.Footer className="p-3">
          <div className="flex flex-col gap-2">
            {state.hasPendingChanges && (
              // saveChanges → pushChanges → updateTheme rejects when the theme no
              // longer exists (#214); mutatePatch has already reported the
              // failure (#221), so absorb the rethrow here.
              <ReacstButton onClick={() => { void actions.saveChanges().catch(() => undefined); }} disabled={state.isPushingChanges} className="w-full">
                {state.isPushingChanges ? 'Pushing…' : 'Save Changes'}
              </ReacstButton>
            )}
          </div>
        </LumaCastPanel.Footer>
      )}
    </LumaCastPanel.Root>
  );
}
