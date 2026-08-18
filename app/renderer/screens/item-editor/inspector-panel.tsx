import { useEffect } from 'react';
import { ReacstButton } from '@renderer/components/controls/button';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Tabs } from '@renderer/components/display/tabs';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { ItemInspector } from '@renderer/features/inspector/item-inspector';
import { SlideBackgroundInspector } from '@renderer/features/inspector/slide-background-inspector';
import { ShapeElementInspector } from '@renderer/features/inspector/shape-element-inspector';
import { TextElementInspector } from '@renderer/features/inspector/text-element-inspector';
import { VideoElementInspector } from '@renderer/features/inspector/video-element-inspector';
import type { InspectorTab } from '@renderer/types/ui';
import { useItemEditorScreen } from './screen-context';

export function ItemEditorInspectorPanel() {
  const { state, actions } = useItemEditorScreen();
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
          <Tabs.List label="Inspector" className="border-b border-primary">
            {!hasSelection && <Tabs.Trigger value="presentation">Item</Tabs.Trigger>}
            {hasSelection && <Tabs.Trigger value="shape">Shape</Tabs.Trigger>}
            {isTextSelected && <Tabs.Trigger value="text">Text</Tabs.Trigger>}
            {isVideoSelected && <Tabs.Trigger value="video">Video</Tabs.Trigger>}
          </Tabs.List>
          <Tabs.Panel value="presentation">
            <ItemInspector />
            <SlideBackgroundInspector />
          </Tabs.Panel>
          <Tabs.Panel value="shape">
            <ShapeElementInspector />
          </Tabs.Panel>
          <Tabs.Panel value="text">
            <TextElementInspector />
          </Tabs.Panel>
          <Tabs.Panel value="video">
            <VideoElementInspector />
          </Tabs.Panel>
        </section>
      </Tabs.Root>
      {state.hasPendingChanges && (
        <LumaCastPanel.Footer className="p-3">
          {/* saveChanges → pushChanges → updateElementsBatch/deleteElementsBatch
              rejects when an element no longer exists (#214); mutatePatch has
              already reported the failure, so absorb the rethrow here. */}
          <ReacstButton onClick={() => { void actions.saveChanges().catch(() => undefined); }} disabled={state.isPushingChanges} className="w-full">
            {state.isPushingChanges ? 'Pushing…' : 'Save Changes'}
          </ReacstButton>
        </LumaCastPanel.Footer>
      )}
    </LumaCastPanel.Root>
  );
}
