import { useEffect } from 'react';
import { Panel, ReacstButton, Tabs } from '@lumacast/ui';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useInspector } from '@renderer/features/inspector/inspector-context';
import { BindingInspector } from '@renderer/features/inspector/binding-inspector';
import { ShapeElementInspector } from '@renderer/features/inspector/shape-element-inspector';
import { SlideInspector } from '@renderer/features/inspector/slide-inspector';
import { EntityBackgroundInspector } from '@renderer/features/inspector/entity-background-inspector';
import { TextElementInspector } from '@renderer/features/inspector/text-element-inspector';
import { VideoElementInspector } from '@renderer/features/inspector/video-element-inspector';
import { useOverlayEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import type { InspectorTab } from '@renderer/types/ui';
import { useOverlayEditorScreen } from './screen-context';

export function OverlayEditorInspectorPanel() {
  const { state, actions } = useOverlayEditorScreen();
  const { inspectorTab, setInspectorTab } = useInspector();
  const { currentOverlay } = useOverlayEditor();
  const { overlaysById } = useProjectContent();
  const { selectedElement } = useElements();
  const hasSelection = Boolean(selectedElement);
  const isTextSelected = selectedElement?.type === 'text';
  const isVideoSelected = selectedElement?.type === 'video';

  useEffect(() => {
    if (!hasSelection) {
      if (inspectorTab !== 'slide') setInspectorTab('slide');
      return;
    }

    if (isTextSelected) {
      if (inspectorTab !== 'shape' && inspectorTab !== 'text' && inspectorTab !== 'binding') setInspectorTab('shape');
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
              {!hasSelection && <Tabs.Tab value="slide">Overlay</Tabs.Tab>}
              {hasSelection && <Tabs.Tab value="shape">Shape</Tabs.Tab>}
              {isTextSelected && <Tabs.Tab value="text">Text</Tabs.Tab>}
              {isTextSelected && <Tabs.Tab value="binding">Text link</Tabs.Tab>}
              {isVideoSelected && <Tabs.Tab value="video">Video</Tabs.Tab>}
            </Tabs.List>
            <Tabs.Panel value="slide">
              <SlideInspector />
              {currentOverlay ? (
                <EntityBackgroundInspector
                  ownerId={currentOverlay.id}
                  background={overlaysById.get(currentOverlay.id)?.background ?? null}
                />
              ) : null}
            </Tabs.Panel>
            <Tabs.Panel value="shape" className="min-h-0 flex-1 overflow-auto">
              <ShapeElementInspector />
            </Tabs.Panel>
            <Tabs.Panel value="text" className="min-h-0 flex-1 overflow-auto">
              <TextElementInspector />
            </Tabs.Panel>
            <Tabs.Panel value="binding" className="min-h-0 flex-1 overflow-auto">
              <BindingInspector />
            </Tabs.Panel>
            <Tabs.Panel value="video" className="min-h-0 flex-1 overflow-auto">
              <VideoElementInspector />
            </Tabs.Panel>
          </section>
        </Tabs>
      </Panel.Body>
      {state.hasPendingChanges && (
        <Panel.Footer className="py-3">
          {/* saveChanges → pushChanges → updateOverlay rejects when the overlay no
              longer exists (#214); mutatePatch has already reported the failure
              (#221), so absorb the rethrow here. */}
          <ReacstButton onClick={() => { void actions.saveChanges().catch(() => undefined); }} disabled={state.isPushingChanges} className="w-full">
            {state.isPushingChanges ? 'Pushing…' : 'Save Changes'}
          </ReacstButton>
        </Panel.Footer>
      )}
    </Panel>
  );
}
