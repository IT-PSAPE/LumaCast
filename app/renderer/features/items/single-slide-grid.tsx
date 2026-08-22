import { useCallback, useMemo, useRef } from 'react';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import { useThumbnailScene } from '../../contexts/canvas/canvas-context';
import { useDeckBrowser } from './deck-browser-context';
import { SortableList, VIRTUALIZED_SORTABLE_MEASURING } from '@renderer/components/layout/sortable-list';
import { getSlideVisualState, slideTextPreview } from '../../utils/slides';
import { itemRefsEqual } from '../../utils/navigation-context-utils';
import { VirtualizedThumbnailGrid } from '@renderer/components/layout/thumbnail-grid';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { SlideGridTile } from './slide-grid-tile';
import { SortableSlideGridTile } from './sortable-slide-grid-tile';
import { useSlideReorder } from './use-slide-reorder';

export function SingleSlideGrid() {
  const { currentItemRef, currentOutputItemRef, isDetachedDeckBrowser } = useNavigation();
  const { slides: persistedSlides, currentSlideIndex, liveSlideIndex, slideElementsById, activateSlide, setCurrentSlideIndex, reorderSlide } = useSlides();
  const getThumbnailScene = useThumbnailScene();
  const { gridItemSize } = useDeckBrowser();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const virtualScrollToRowIndexRef = useRef<((index: number) => void) | null>(null);
  const getScrollElement = useCallback(() => viewportRef.current, []);
  const scrollToIndex = useCallback((index: number) => {
    virtualScrollToRowIndexRef.current?.(Math.floor(index / gridItemSize));
  }, [gridItemSize]);
  const showLiveState = !isDetachedDeckBrowser && itemRefsEqual(currentItemRef, currentOutputItemRef);
  const { items: slides, dnd } = useSlideReorder(persistedSlides, reorderSlide);
  const virtualizedGrid = useMemo(() => ({ columns: gridItemSize }), [gridItemSize]);
  const virtualizedKeyboard = useMemo(() => ({
    columns: gridItemSize,
    onMoveToIndex: dnd.onKeyboardMoveToIndex,
    scrollToIndex,
  }), [dnd.onKeyboardMoveToIndex, gridItemSize, scrollToIndex]);
  const activeSlideIndex = dnd.activeId ? slides.findIndex((slide) => slide.id === dnd.activeId) : -1;
  const activeSlide = activeSlideIndex === -1 ? null : slides[activeSlideIndex];
  const activeElements = activeSlide ? slideElementsById.get(activeSlide.id) ?? [] : [];
  const activeScene = activeSlide ? getThumbnailScene(activeSlide.id, 'show') : null;
  const activeState = activeSlide ? getSlideVisualState(
    activeSlideIndex,
    showLiveState ? liveSlideIndex : -1,
    currentSlideIndex,
    activeElements,
  ) : null;

  return (
    <ScrollArea.Root scrollPadding={16}>
      <ScrollArea.Viewport ref={viewportRef} className="p-2">
        <SortableList.Root
          {...dnd}
          layout="grid"
          measuring={VIRTUALIZED_SORTABLE_MEASURING}
          activeId={dnd.activeId}
          virtualizedGrid={virtualizedGrid}
          virtualizedKeyboard={virtualizedKeyboard}
          dragOverlay={activeSlide && activeScene && activeState ? (
            <SlideGridTile
              slideId={activeSlide.id}
              index={activeSlideIndex}
              scene={activeScene}
              selected={activeSlideIndex === currentSlideIndex}
              isLive={activeState === 'live'}
              isEmpty={activeState === 'warning'}
              textPreview={slideTextPreview(activeElements)}
              onActivate={activateSlide}
              onFocus={setCurrentSlideIndex}
              overlay
            />
          ) : null}
        >
          <VirtualizedThumbnailGrid
            columns={gridItemSize}
            getScrollElement={getScrollElement}
            estimateRowSize={160}
            activeIndex={currentSlideIndex}
            retainedIndexes={activeSlideIndex === -1 ? [] : [activeSlideIndex]}
            scrollToIndexRef={virtualScrollToRowIndexRef}
            className="auto-rows-max content-start isolate"
            role="grid"
            aria-label="Slides"
          >
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
          </VirtualizedThumbnailGrid>
        </SortableList.Root>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
