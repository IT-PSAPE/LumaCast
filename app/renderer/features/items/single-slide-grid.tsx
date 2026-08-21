import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useDeckBrowser } from './deck-browser-context';
import { SortableList } from '@renderer/components/layout/sortable-list';
import { getSlideVisualState, slideTextPreview } from '../../utils/slides';
import { itemRefsEqual } from '../../utils/navigation-context-utils';
import { ThumbnailGrid } from '@renderer/components/layout/thumbnail-grid';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { SortableSlideGridTile } from './sortable-slide-grid-tile';
import { useSlideReorder } from './use-slide-reorder';

export function SingleSlideGrid() {
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
