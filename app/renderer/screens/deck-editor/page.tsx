import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Play, Plus, Search } from 'lucide-react';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import type { Id } from '@core/types';
import { cn } from '@renderer/utils/cn';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { DeckItemIcon } from '../../components/display/entity-icon';
import { Dropdown } from '../../components/form/dropdown';
import { FieldTextarea } from '../../components/form/field';
import { Popover } from '../../components/overlays/popover';
import { getSlideVisualState, slideTextPreview } from '../../utils/slides';
import { StagePanel } from '../../features/canvas/stage-panel';
import { SplitPanel } from '@renderer/components/layout/panel-split/split-panel';
import { Thumbnail } from '@renderer/components/display/thumbnail';
import { SceneFrame } from '@renderer/components/display/scene-frame';
import type { RenderScene } from '@renderer/features/canvas/scene-types';
import { EmptyState } from '@renderer/components/display/empty-state';
import { LazySceneStage } from '@renderer/components/display/lazy-scene-stage';
import { ScrollArea, useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { Label } from '@renderer/components/display/text';
import { DeckEditorInspectorPanel } from './inspector-panel';
import { DeckEditorLayersPanel } from './layers-panel';
import { DeckEditorScreenProvider, useDeckEditorScreen } from './screen-context';

export function DeckEditorScreen() {
  return (
    <DeckEditorScreenProvider>
      <DeckEditorScreenContent />
    </DeckEditorScreenProvider>
  );
}

function DeckEditorScreenContent() {
  const { state, actions } = useDeckEditorScreen();

  return (
      <SplitPanel.Panel splitId="edit-main" orientation="horizontal" className="h-full" data-ui-region="deck-editor-layout">
        {/* LEFT PANEL: LAYERS PANEL */}
        <SplitPanel.Segment id="edit-left" defaultSize={280} minSize={140} collapsible>
          <LumaCastPanel.Root className="h-full border-r border-secondary">
            <SplitPanel.Panel splitId={'slide-list-panel'} orientation="vertical" className="h-full">
              <SplitPanel.Segment id={'slide-list'} defaultSize={440} minSize={180}>
                <LumaCastPanel.Group className="h-full min-h-0">
                  <LumaCastPanel.GroupTitle>
                    <DeckItemPicker />
                    <Dropdown>
                      <Dropdown.Trigger
                        aria-label="Add"
                        className="cursor-pointer rounded-sm bg-tertiary p-1 text-primary transition-colors hover:text-primary [&>svg]:size-4"
                      >
                        <Plus />
                      </Dropdown.Trigger>
                      <Dropdown.Panel placement="bottom-end">
                        <Dropdown.Item onClick={() => actions.openCreateDeckItem('lyric')}>
                          New lyric
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => actions.openCreateDeckItem('presentation')}>
                          New presentation
                        </Dropdown.Item>
                        <Dropdown.Separator />
                        <Dropdown.Item onClick={() => { void actions.createSlide(); }} disabled={!state.currentDeckItem}>
                          New slide
                        </Dropdown.Item>
                      </Dropdown.Panel>
                    </Dropdown>
                  </LumaCastPanel.GroupTitle>
                  <LumaCastPanel.Content className="min-h-0">
                    {!state.currentDeckItem ? (
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
                      <ScrollArea.Root>
                        <ScrollArea.Viewport className="p-2">
                          <div className="grid min-w-0 grid-cols-1 content-start gap-3" role="grid" aria-label={`Current ${state.currentDeckItem?.type === 'lyric' ? 'lyrics' : 'slides'}`}>
                            {state.slides.map((slide, index) => (
                              <DeckEditorSlideListItem key={slide.id} slide={slide} index={index} />
                            ))}
                          </div>
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
                    <DeckEditorLayersPanel />
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
                <FieldTextarea
                  value={state.notesPanel.notesDraft}
                  onChange={state.notesPanel.handleNotesChange}
                  onBlur={state.notesPanel.handleSaveNotes}
                  placeholder={state.notesPanel.placeholder}
                  resize="none"
                  className="h-full min-h-0 w-full resize-none rounded-none border-none bg-transparent p-4 focus:border-0 paragraph-sm"
                />
              </section>
            </SplitPanel.Segment>
          </SplitPanel.Panel>
        </SplitPanel.Segment>

        {/* RIGHT PANEL: INSPECTOR PANEL*/}
        <SplitPanel.Segment id="edit-right" defaultSize={320} minSize={140} collapsible>
          <DeckEditorInspectorPanel />
        </SplitPanel.Segment>
      </SplitPanel.Panel>
  );
}

function DeckEditorSlideListItem({
  slide,
  index,
}: {
  slide: ReturnType<typeof useDeckEditorScreen>['state']['slides'][number];
  index: number;
}) {
  const { state, actions } = useDeckEditorScreen();
  const elements = state.currentSlide?.id === slide.id ? state.effectiveElements : actions.getSlideElements(slide.id);
  const scene = actions.getThumbnailScene(slide.id, 'deck-editor');
  if (!scene) return null;

  const visualState = getSlideVisualState(index, state.liveSlideIndex, state.currentSlideIndex, elements);

  function handleSelect() {
    actions.setCurrentSlideIndex(index);
  }

  return (
    <SlideTile
      slideId={slide.id}
      scene={scene}
      index={index}
      isActive={index === state.currentSlideIndex}
      isLive={visualState === 'live'}
      isEmpty={visualState === 'warning'}
      textPreview={slideTextPreview(elements)}
      onSelect={handleSelect}
    />
  );
}

interface SlideTileProps {
  slideId: Id;
  scene: RenderScene;
  index: number;
  isActive: boolean;
  isLive: boolean;
  isEmpty: boolean;
  textPreview: string;
  onSelect: () => void;
}

function SlideTile({ slideId, scene, index, isActive, isLive, isEmpty, textPreview, onSelect }: SlideTileProps) {
  return (
    <ContextMenu.Root>
      <SlideTileBody
        slideId={slideId}
        scene={scene}
        index={index}
        isActive={isActive}
        isLive={isLive}
        isEmpty={isEmpty}
        textPreview={textPreview}
        onSelect={onSelect}
      />
    </ContextMenu.Root>
  );
}

function SlideTileBody({ slideId, scene, index, isActive, isLive, isEmpty, textPreview, onSelect }: SlideTileProps) {
  const { state, actions } = useDeckEditorScreen();
  const confirm = useConfirm();
  const isFirst = index === 0;
  const isLast = index === state.slides.length - 1;
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete slide ${index + 1}?`,
      description: 'This slide and all its elements will be permanently removed.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await actions.deleteSlide(slideId);
  }

  return (
    <>
      <Thumbnail.Tile
        {...triggerHandlers}
        ref={(node) => {
          activeRef.current = node;
          triggerRef(node);
        }}
        onClick={onSelect}
        onDoubleClick={onSelect}
        selected={isActive}
      >
        <Thumbnail.Body>
          <SceneFrame width={scene.width} height={scene.height} className="bg-tertiary" stageClassName="absolute inset-0" checkerboard>
            {isEmpty && (
              <div className="absolute inset-0 z-10 grid place-items-center text-sm uppercase tracking-wider text-tertiary">
                Empty
              </div>
            )}
            <LazySceneStage scene={scene} surface="list" className="absolute inset-0" />
          </SceneFrame>
        </Thumbnail.Body>
        {isLive && (
          <Thumbnail.Overlay position="top-left">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-[2px] bg-brand_solid text-white shadow-sm">
              <Play size={12} strokeWidth={1.9} />
            </span>
          </Thumbnail.Overlay>
        )}
        <Thumbnail.Caption>
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
            <span className="min-w-0 truncate text-sm text-tertiary">{textPreview}</span>
          </div>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => { void actions.duplicateSlide(slideId); }}>Duplicate</ContextMenu.Item>
          <ContextMenu.Item disabled={isFirst} onSelect={() => { void actions.moveSlide(slideId, 'up'); }}>Move up</ContextMenu.Item>
          <ContextMenu.Item disabled={isLast} onSelect={() => { void actions.moveSlide(slideId, 'down'); }}>Move down</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

// Combobox-style picker that replaces the static deck-item title in the
// edit screen's left panel. Click the trigger to open a popover with a
// search input and a filtered list of deck items; pick one to switch.
function DeckItemPicker() {
  const { state, actions } = useDeckEditorScreen();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return state.deckItems;
    return state.deckItems.filter((item) => item.title.toLowerCase().includes(q));
  }, [filter, state.deckItems]);

  const listboxId = 'deck-editor-item-picker-listbox';
  const activeOptionId = filtered[highlightedIndex] ? `deck-editor-item-option-${filtered[highlightedIndex].id}` : undefined;

  function handleOpen() {
    setOpen(true);
    setFilter('');
    setHighlightedIndex(0);
    // Focus the search input on next paint, after the popover mounts.
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleClose() {
    setOpen(false);
  }

  function handleSelect(id: Id) {
    actions.browseDeckItem(id);
    handleClose();
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, Math.max(0, filtered.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filtered[highlightedIndex];
      if (target) handleSelect(target.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open ? handleClose : handleOpen}
        aria-label="Select deck item"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className="h-6.5 flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-tertiary"
        title={state.currentDeckItem?.title ?? 'No item selected'}
      >
        {state.currentDeckItem ? <DeckItemIcon entity={state.currentDeckItem} className="shrink-0 text-tertiary" /> : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
          {state.currentDeckItem?.title ?? 'No item selected'}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-tertiary" />
      </button>
      <Popover anchor={triggerRef.current} open={open} onClose={handleClose} placement="bottom-start" offset={4} axisLock>
        <div className="flex w-72 flex-col overflow-hidden rounded-md border border-primary bg-primary shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-primary px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-tertiary" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
              data-shortcuts-scope="ignore"
              value={filter}
              onChange={(event) => { setFilter(event.target.value); setHighlightedIndex(0); }}
              onKeyDown={handleInputKeyDown}
              placeholder="Search deck items"
              className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-tertiary"
            />
          </div>
          <div ref={listRef} id={listboxId} role="listbox" aria-label="Deck items" className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-1.5 text-sm text-tertiary">No deck items match.</div>
            ) : (
              filtered.map((item, index) => (
                <DeckItemPickerOption
                  key={item.id}
                  item={item}
                  isCurrent={item.id === state.currentDeckItemId}
                  isHighlighted={index === highlightedIndex}
                  onSelect={handleSelect}
                  onHighlight={() => setHighlightedIndex(index)}
                />
              ))
            )}
          </div>
        </div>
      </Popover>
    </>
  );
}

function DeckItemPickerOption({
  item,
  isCurrent,
  isHighlighted,
  onSelect,
  onHighlight,
}: {
  item: ReturnType<typeof useDeckEditorScreen>['state']['deckItems'][number];
  isCurrent: boolean;
  isHighlighted: boolean;
  onSelect: (id: Id) => void;
  onHighlight: () => void;
}) {
  function handleSelect() {
    onSelect(item.id);
  }

  return (
    <button
      id={`deck-editor-item-option-${item.id}`}
      type="button"
      role="option"
      aria-selected={isHighlighted}
      onClick={handleSelect}
      onMouseEnter={onHighlight}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
        isCurrent ? 'text-primary' : 'text-secondary',
        isHighlighted ? 'bg-tertiary text-primary' : 'hover:bg-tertiary hover:text-primary',
      )}
    >
      <DeckItemIcon entity={item} className="shrink-0 text-tertiary" />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {isCurrent ? <span className="shrink-0 text-xs uppercase tracking-wide text-tertiary">current</span> : null}
    </button>
  );
}
