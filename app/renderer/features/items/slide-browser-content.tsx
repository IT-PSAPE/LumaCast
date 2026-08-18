import { useCallback, type ComponentProps } from 'react';
import { useNavigation } from '../../contexts/navigation-context';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useSlides } from '../../contexts/slide-context';
import { EmptyState } from '../../components/display/empty-state';
import { ThumbnailGrid } from '../../components/layout/thumbnail-grid';
import { ScrollArea } from '../../components/layout/scroll-area';
import { SortableList, useSortableItem, useSortableOrder, type SortableOrderCommit } from '../../components/layout/sortable-list';
import { getSlideVisualState, slideTextPreview } from '../../utils/slides';
import { itemRefsEqual } from '../../utils/navigation-context-utils';
import { useDeckBrowser } from './deck-browser-context';
import { SlideGridTile } from './slide-grid-tile';
import { SlideOutlineRow } from './slide-list-row';
import { useOutlineView } from './use-slide-list-view';
import type { SlideBrowserContentVariant } from './use-deck-browser-view';
import type { Id } from '@lumacast/kernel';
import type { Slide } from '@lumacast/composition';

interface SlideBrowserContentProps {
  variant: SlideBrowserContentVariant;
}

export function SlideBrowserContent({ variant }: SlideBrowserContentProps) {
  if (variant !== 'single-grid' && variant !== 'single-list') return null;
  return variant === 'single-grid' ? <SingleSlideGrid /> : <SingleSlideList />;
}

function SingleSlideGrid() {
  const { currentItemRef, currentOutputItemRef, isDetachedDeckBrowser } = useNavigation();
  const { slides: persistedSlides, currentSlideIndex, liveSlideIndex, slideElementsById, activateSlide, setCurrentSlideIndex, reorderSlide } = useSlides();
  const { getThumbnailScene } = useRenderScenes();
  const { gridItemSize } = useDeckBrowser();
  const showLiveState = !isDetachedDeckBrowser && itemRefsEqual(currentItemRef, currentOutputItemRef);
  const { items: slides, dnd } = useSlideReorder(persistedSlides, reorderSlide);

  return (
    <ScrollArea.Root scrollPadding={16}>
      <ScrollArea.Viewport className="p-2">
        <SortableList.Root {...dnd} layout="grid">
          <ThumbnailGrid columns={gridItemSize} className="auto-rows-max content-start isolate" role="grid" aria-label="Slides">
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
        </SortableList.Root>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

function SingleSlideList() {
  const { rows: persistedRows, currentSlideIndex, selectSlide, openSlide, updateText } = useOutlineView();
  const { reorderSlide } = useSlides();
  const { getThumbnailScene } = useRenderScenes();
  const { items: rows, dnd } = useSortableOrder({
    items: persistedRows,
    getId: outlineRowId,
    commit: useSlideReorderCommit(reorderSlide),
  });

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
        <SortableList.Root {...dnd}>
          <div className="isolate flex flex-col gap-3" role="list" aria-label="Slide outline">
            {rows.map(renderRow)}
          </div>
        </SortableList.Root>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

const slideId = (slide: Slide) => slide.id;
const outlineRowId = (row: { slide: Slide }) => row.slide.id;

/**
 * `reorderSlide` already ignores an out-of-range or unchanged target and
 * rejects when the slide is gone (#214) — that rejection is what reverts the
 * optimistic order, so it is deliberately not swallowed here.
 */
function useSlideReorderCommit(reorderSlide: (slideId: Id, newOrder: number) => Promise<void>) {
  return useCallback(
    ({ id, toIndex }: SortableOrderCommit) => reorderSlide(id, toIndex),
    [reorderSlide],
  );
}

function useSlideReorder(slides: Slide[], reorderSlide: (slideId: Id, newOrder: number) => Promise<void>) {
  return useSortableOrder({ items: slides, getId: slideId, commit: useSlideReorderCommit(reorderSlide) });
}

function SortableSlideGridTile(props: ComponentProps<typeof SlideGridTile>) {
  const { containerRef, containerStyle, isDragging, handleProps } = useSortableItem(props.slideId);
  return (
    <SlideGridTile
      {...props}
      containerRef={containerRef}
      containerStyle={containerStyle}
      dragging={isDragging}
      dragHandleProps={handleProps}
    />
  );
}

function SortableSlideOutlineRow(props: ComponentProps<typeof SlideOutlineRow>) {
  const { containerRef, containerStyle, isDragging, handleProps } = useSortableItem(props.row.slide.id);
  return (
    <SlideOutlineRow
      {...props}
      containerRef={containerRef}
      containerStyle={containerStyle}
      dragging={isDragging}
      dragHandleProps={handleProps}
    />
  );
}
