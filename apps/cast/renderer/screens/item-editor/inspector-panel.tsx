import { useEffect } from 'react';
import { Panel, ReacstButton, Tabs } from '@lumacast/ui';
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
    <Panel className="border-l border-secondary" data-ui-region="inspector-panel">
      <Panel.Body scroll={false} className="flex flex-col">
        <Tabs value={inspectorTab} variant="plain" className="contents" onValueChange={handleTabChange}>
          <section className="flex min-h-0 flex-1 flex-col">
            <Tabs.List aria-label="Inspector" className="border-b border-primary min-w-0 overflow-x-auto [&>*]:shrink-0">
              {!hasSelection && <Tabs.Tab value="presentation">Item</Tabs.Tab>}
              {hasSelection && <Tabs.Tab value="shape">Shape</Tabs.Tab>}
              {isTextSelected && <Tabs.Tab value="text">Text</Tabs.Tab>}
              {isVideoSelected && <Tabs.Tab value="video">Video</Tabs.Tab>}
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
        </Tabs>
      </Panel.Body>
      {state.hasPendingChanges && (
        <Panel.Footer className="py-3">
          {/* saveChanges → pushChanges → updateElementsBatch/deleteElementsBatch
              rejects when an element no longer exists (#214); mutatePatch has
              already reported the failure, so absorb the rethrow here. */}
          <ReacstButton onClick={() => { void actions.saveChanges().catch(() => undefined); }} disabled={state.isPushingChanges} className="w-full">
            {state.isPushingChanges ? 'Pushing…' : 'Save Changes'}
          </ReacstButton>
        </Panel.Footer>
      )}
    </Panel>
  );
}
