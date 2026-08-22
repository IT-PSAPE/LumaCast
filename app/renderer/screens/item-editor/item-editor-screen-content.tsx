import { useCallback, useRef } from 'react';
import { Plus } from 'lucide-react';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { EmptyState } from '@renderer/components/display/empty-state';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { Label } from '@renderer/components/display/text';
import { Dropdown } from '../../components/form/dropdown';
import { FieldTextarea } from '../../components/form/field';
import { StagePanel } from '../../features/canvas/stage-panel';
import { TalkScriptBlocksPanel } from '../../features/items/talk-script-blocks-panel';
import { useItemEditorScreen } from './screen-context';
import { ItemPicker } from './item-picker';
import { ItemEditorSlideList } from './item-editor-slide-list';
import { ItemEditorLayersPanel } from './layers-panel';
import { ItemEditorInspectorPanel } from './inspector-panel';

export function ItemEditorScreenContent() {
  const { state, actions } = useItemEditorScreen();
  const slideListViewportRef = useRef<HTMLDivElement | null>(null);
  const getSlideListScrollElement = useCallback(() => slideListViewportRef.current, []);

  return (
    <SplitPanel.Panel splitId="edit-main" orientation="horizontal" className="h-full" data-ui-region="item-editor-layout">
      {/* LEFT PANEL: LAYERS PANEL */}
      <SplitPanel.Segment id="edit-left" defaultSize={280} minSize={140} collapsible>
        <LumaCastPanel.Root className="h-full border-r border-secondary">
          <SplitPanel.Panel splitId={'slide-list-panel'} orientation="vertical" className="h-full">
            <SplitPanel.Segment id={'slide-list'} defaultSize={440} minSize={180}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle>
                  <ItemPicker />
                  <Dropdown>
                    <Dropdown.Trigger
                      aria-label="Add"
                      className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary [&>svg]:size-4"
                    >
                      <Plus />
                    </Dropdown.Trigger>
                    <Dropdown.Panel placement="bottom-end">
                      <Dropdown.Item onClick={() => actions.openCreateItem('lyric')}>
                        New lyric
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => actions.openCreateItem('presentation')}>
                        New presentation
                      </Dropdown.Item>
                      <Dropdown.Item onClick={() => actions.openCreateItem('talk')}>
                        New talk
                      </Dropdown.Item>
                      <Dropdown.Separator />
                      <Dropdown.Item onClick={() => { void actions.createSlide(); }} disabled={!state.currentItem}>
                        New slide
                      </Dropdown.Item>
                    </Dropdown.Panel>
                  </Dropdown>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content className="min-h-0">
                  {!state.currentItem ? (
                    <EmptyState.Root>
                      <EmptyState.Title>No item selected</EmptyState.Title>
                      <EmptyState.Description>Pick a presentation or lyric from the menu above to start editing.</EmptyState.Description>
                    </EmptyState.Root>
                  ) : state.slides.length === 0 ? (
                    <EmptyState.Root>
                      <EmptyState.Title>No slides yet</EmptyState.Title>
                      <EmptyState.Description>Click the + button to add your first slide.</EmptyState.Description>
                    </EmptyState.Root>
                  ) : (
                    <ScrollArea.Root scrollPadding={8}>
                      <ScrollArea.Viewport ref={slideListViewportRef} className="p-2">
                        <ItemEditorSlideList getScrollElement={getSlideListScrollElement} />
                      </ScrollArea.Viewport>
                      <ScrollArea.Scrollbar>
                        <ScrollArea.Thumb />
                      </ScrollArea.Scrollbar>
                    </ScrollArea.Root>
                  )}
                </LumaCastPanel.Content>
              </LumaCastPanel.Group>
            </SplitPanel.Segment>
            <SplitPanel.Segment id={"slide-objects"} defaultSize={220} minSize={160}>
              <LumaCastPanel.Group className="h-full min-h-0">
                <LumaCastPanel.GroupTitle className="border-t">
                  <Label.xs className="mr-auto">Layers</Label.xs>
                </LumaCastPanel.GroupTitle>
                <LumaCastPanel.Content className="overflow-y-auto p-2">
                  <ItemEditorLayersPanel />
                </LumaCastPanel.Content>
              </LumaCastPanel.Group>
            </SplitPanel.Segment>
          </SplitPanel.Panel>
        </LumaCastPanel.Root>
      </SplitPanel.Segment>

      {/* CENTER PANEL: CANVAS & NOTES PANEL */}
      <SplitPanel.Segment id="edit-center" defaultSize={840} minSize={360}>
        <SplitPanel.Panel splitId="edit-center" orientation="vertical" className="h-full">
          <SplitPanel.Segment id="edit-middle" defaultSize={620} minSize={240}>
            <StagePanel />
          </SplitPanel.Segment>
          <SplitPanel.Segment id="edit-bottom" defaultSize={220} minSize={120} collapsible>
            <section data-ui-region="slide-notes-panel" className="relative h-full min-h-0 overflow-hidden border-t border-primary bg-secondary">
              {/* <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-end">
                <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-primary bg-primary/95 p-1 shadow-sm backdrop-blur-sm">
                  <ReacstButton onClick={state.notesPanel.handleResetNotes} disabled={!state.notesPanel.hasSlide || !state.notesPanel.isDirty} variant="ghost">
                    Reset
                  </ReacstButton>
                  <ReacstButton onClick={state.notesPanel.handleSaveNotes} disabled={!state.notesPanel.canEdit || !state.notesPanel.isDirty}>
                    Save
                  </ReacstButton>
                </div>
              </div> */}
              {state.currentItemRef?.type === 'talk' && state.currentSlide ? (
                <TalkScriptBlocksPanel slideId={state.currentSlide.id} />
              ) : (
                <FieldTextarea
                  value={state.notesPanel.notesDraft}
                  onChange={state.notesPanel.handleNotesChange}
                  onBlur={state.notesPanel.handleSaveNotes}
                  placeholder={state.notesPanel.placeholder}
                  resize="none"
                  className="h-full min-h-0 w-full resize-none rounded-none border-none bg-transparent p-4 focus:border-0 paragraph-sm"
                />
              )}
            </section>
          </SplitPanel.Segment>
        </SplitPanel.Panel>
      </SplitPanel.Segment>

      {/* RIGHT PANEL: INSPECTOR PANEL*/}
      <SplitPanel.Segment id="edit-right" defaultSize={320} minSize={140} collapsible>
        <ItemEditorInspectorPanel />
      </SplitPanel.Segment>
    </SplitPanel.Panel>
  );
}
