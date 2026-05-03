import { useEffect } from 'react';
import { ReacstButton } from '@renderer/components/controls/button';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Tabs } from '@renderer/components/display/tabs';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { DeckItemInspector } from '@renderer/features/inspector/presentation-inspector';
import { ShapeElementInspector } from '@renderer/features/inspector/shape-element-inspector';
import { TextElementInspector } from '@renderer/features/inspector/text-element-inspector';
import { VideoElementInspector } from '@renderer/features/inspector/video-element-inspector';
import type { InspectorTab } from '@renderer/types/ui';
import { useDeckEditorScreen } from './screen-context';

export function DeckEditorInspectorPanel() {
  const { state, actions } = useDeckEditorScreen();
  const { inspectorTab, setInspectorTab } = useInspector();
  const { selectedElement } = useElements();
  const hasSelection = Boolean(selectedElement);
  const isTextSelected = selectedElement?.type === 'text';
  const isVideoSelected = selectedElement?.type === 'video';

  useEffect(() => {
    if (!hasSelection) {
      if (inspectorTab === 'shape' || inspectorTab === 'text' || inspectorTab === 'slide' || inspectorTab === 'video') {
        setInspectorTab('presentation');
      }
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
      <Tabs.Root value={inspectorTab} onValueChange={handleTabChange}>
        <section className="flex flex-1 flex-col">
          <div className="border-b border-primary">
            <Tabs.List label="Inspector">
              {!hasSelection && <Tabs.Trigger value="presentation">Item</Tabs.Trigger>}
              {hasSelection && <Tabs.Trigger value="shape">Shape</Tabs.Trigger>}
              {isTextSelected && <Tabs.Trigger value="text">Text</Tabs.Trigger>}
              {isVideoSelected && <Tabs.Trigger value="video">Video</Tabs.Trigger>}
            </Tabs.List>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {inspectorTab === 'presentation' && <DeckItemInspector />}
            {inspectorTab === 'shape' && <ShapeElementInspector />}
            {inspectorTab === 'text' && <TextElementInspector />}
            {inspectorTab === 'video' && <VideoElementInspector />}
          </div>
        </section>
      </Tabs.Root>
      {state.hasPendingChanges && (
        <LumaCastPanel.Footer className="p-3">
          <ReacstButton onClick={() => { void actions.saveChanges(); }} disabled={state.isPushingChanges} className="w-full">
            {state.isPushingChanges ? 'Pushing…' : 'Save Changes'}
          </ReacstButton>
        </LumaCastPanel.Footer>
      )}
    </LumaCastPanel.Root>
  );
}
