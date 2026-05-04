import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { SortableContext, sortableKeyboardCoordinates, useSortable, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { ComponentProps } from 'react';
import { useNavigation } from '../../contexts/navigation-context';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useSlides } from '../../contexts/slide-context';
import { EmptyState } from '../../components/display/empty-state';
import { ThumbnailGrid } from '../../components/layout/thumbnail-grid';
import { ScrollArea } from '../../components/layout/scroll-area';
import { getSlideVisualState, slideTextPreview } from '../../utils/slides';
import { useDeckBrowser } from './deck-browser-context';
import { SlideGridTile } from './slide-grid-tile';
import { SlideOutlineRow } from './slide-list-row';
import { useOutlineView } from './use-slide-list-view';
import type { SlideBrowserContentVariant } from './use-deck-browser-view';
import type { Id } from '@core/types';

interface SlideBrowserContentProps {
  variant: SlideBrowserContentVariant;
}

export function SlideBrowserContent({ variant }: SlideBrowserContentProps) {
  if (variant !== 'single-grid' && variant !== 'single-list') return null;
  return variant === 'single-grid' ? <SingleSlideGrid /> : <SingleSlideList />;
}

function SingleSlideGrid() {
  const { currentDeckItemId, currentOutputDeckItemId, isDetachedDeckBrowser } = useNavigation();
  const { slides, currentSlideIndex, liveSlideIndex, slideElementsById, activateSlide, setCurrentSlideIndex, reorderSlide } = useSlides();
  const { getThumbnailScene } = useRenderScenes();
  const { gridItemSize } = useDeckBrowser();
  const showLiveState = !isDetachedDeckBrowser && currentDeckItemId === currentOutputDeckItemId;
  const sensors = useSlideReorderSensors();
  const handleDragEnd = useSlideReorderHandler(slides.map((slide) => slide.id), reorderSlide);

  return (
    <ScrollArea.Root>
      <ScrollArea.Viewport className="p-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={slides.map((slide) => slide.id)} strategy={rectSortingStrategy}>
            <ThumbnailGrid columns={gridItemSize} className="auto-rows-max content-start" role="grid" aria-label="Slides">
              {slides.map((slide, idx) => {
                const elements = slideElementsById.get(slide.id) ?? [];
                const scene = getThumbnailScene(slide.id, 'show');
                if (!scene) return null;
                const state = getSlideVisualState(idx, showLiveState ? liveSlideIndex : -1, currentSlideIndex, elements);

                return (
                  <SortableSlideGridTile
                    key={slide.id}
                    slideId={slide.id}
                    index={idx}
                    scene={scene}
                    selected={idx === currentSlideIndex}
                    isLive={state === 'live'}
                    isEmpty={state === 'warning'}
                    textPreview={slideTextPreview(elements)}
                    onActivate={activateSlide}
                    onFocus={setCurrentSlideIndex}
                  />
                );
              })}
            </ThumbnailGrid>
          </SortableContext>
        </DndContext>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

function SingleSlideList() {
  const { rows, currentSlideIndex, selectSlide, openSlide, updateText } = useOutlineView();
  const { reorderSlide } = useSlides();
  const { getThumbnailScene } = useRenderScenes();
  const sensors = useSlideReorderSensors();
  const handleDragEnd = useSlideReorderHandler(rows.map((row) => row.slide.id), reorderSlide);

  function renderRow(row: (typeof rows)[number]) {
    const scene = getThumbnailScene(row.slide.id, 'list');
    if (!scene) return null;
    return (
      <SortableSlideOutlineRow
        key={row.slide.id}
        row={row}
        scene={scene}
        isFocused={row.index === currentSlideIndex}
        onSelect={selectSlide}
        onOpen={openSlide}
        onTextCommit={updateText}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Title>No slides available.</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  return (
    <ScrollArea.Root>
      <ScrollArea.Viewport className="p-2">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={rows.map((row) => row.slide.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-3" role="list" aria-label="Slide outline">
              {rows.map(renderRow)}
            </div>
          </SortableContext>
        </DndContext>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

function useSlideReorderSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

function useSlideReorderHandler(slideIds: Id[], reorderSlide: (slideId: Id, newOrder: number) => Promise<void>) {
  return async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const currentIndex = slideIds.findIndex((id) => id === active.id);
    const nextIndex = slideIds.findIndex((id) => id === over.id);
    if (currentIndex < 0 || nextIndex < 0 || currentIndex === nextIndex) return;
    await reorderSlide(String(active.id), nextIndex);
  };
}

function SortableSlideGridTile(props: ComponentProps<typeof SlideGridTile>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.slideId });
  return (
    <SlideGridTile
      {...props}
      containerRef={setNodeRef}
      containerStyle={{ transform: CSS.Transform.toString(transform), transition }}
      dragging={isDragging}
      dragHandleProps={{ ...attributes, ...listeners }}
    />
  );
}

function SortableSlideOutlineRow(props: ComponentProps<typeof SlideOutlineRow>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.row.slide.id });
  return (
    <SlideOutlineRow
      {...props}
      containerRef={setNodeRef}
      containerStyle={{ transform: CSS.Transform.toString(transform), transition }}
      dragging={isDragging}
      dragHandleProps={{ ...attributes, ...listeners }}
    />
  );
}
