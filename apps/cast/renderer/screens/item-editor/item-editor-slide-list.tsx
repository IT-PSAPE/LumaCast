import { useCallback, useMemo, useRef } from 'react';
import { SortableList, useSortableOrder, VIRTUALIZED_SORTABLE_MEASURING, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { VirtualizedList } from '@renderer/components/layout/virtualized-list';
import { useItemEditorScreen } from './screen-context';
import { getSlideVisualState } from '../../utils/slides';
import { ItemEditorSlideListItem } from './item-editor-slide-list-item';
import { SlideTile } from './slide-tile';
import { useSlideRangeSelection } from '../../hooks/use-slide-range-selection';
import { SlideTagManagerProvider } from '../../features/items/slide-tag-manager';

const slideId = (slide: ReturnType<typeof useItemEditorScreen>['state']['slides'][number]) => slide.id;

export function ItemEditorSlideList({ getScrollElement }: { getScrollElement: () => HTMLDivElement | null }) {
  const { state, actions } = useItemEditorScreen();
  const virtualScrollToIndexRef = useRef<((index: number) => void) | null>(null);
  const scrollToIndex = useCallback((index: number) => {
    virtualScrollToIndexRef.current?.(index);
  }, []);

  const commitReorder = useCallback(
    // Unguarded: a rejection (slide deleted mid-drag, #214) is what reverts the
    // optimistic order in useSortableOrder.
    ({ id, toIndex }: SortableOrderCommit) => actions.reorderSlide(id, toIndex),
    [actions],
  );

  const { items: slides, dnd } = useSortableOrder({
    items: state.slides,
    getId: slideId,
    commit: commitReorder,
  });
  const slideIds = useMemo(() => slides.map((slide) => slide.id), [slides]);
  const selection = useSlideRangeSelection(
    slideIds,
    state.currentSlideIndex,
    state.currentItemRef ? `${state.currentItemRef.type}:${state.currentItemRef.id}` : null,
  );
  const activeSlideIndex = dnd.activeId ? slides.findIndex((slide) => slide.id === dnd.activeId) : -1;
  const activeSlide = activeSlideIndex === -1 ? null : slides[activeSlideIndex];
  const activeElements = activeSlide
    ? (state.currentSlide?.id === activeSlide.id ? state.effectiveElements : actions.getSlideElements(activeSlide.id))
    : [];
  const activeScene = activeSlide ? actions.getThumbnailScene(activeSlide.id, 'deck-editor') : null;
  const activeVisualState = activeSlide ? getSlideVisualState(
    activeSlideIndex,
    state.liveSlideIndex,
    state.currentSlideIndex,
    activeElements,
  ) : null;

  function handleSelect(index: number, extendRange: boolean) {
    selection.selectSlide(index, extendRange);
    if (extendRange) return;
    actions.setCurrentSlideIndex(index);
  }

  return (
    <SlideTagManagerProvider>
      <SortableList.Root
        {...dnd}
        measuring={VIRTUALIZED_SORTABLE_MEASURING}
        activeId={dnd.activeId}
        virtualizedKeyboard={{
          onMoveToIndex: dnd.onKeyboardMoveToIndex,
          scrollToIndex,
        }}
        dragOverlay={activeSlide && activeScene && activeVisualState ? (
          <SlideTile
            slideId={activeSlide.id}
            scene={activeScene}
            index={activeSlideIndex}
            isActive={activeSlideIndex === state.currentSlideIndex}
            isSelected={selection.selectedSlideIds.has(activeSlide.id)}
            isLive={activeVisualState === 'live'}
            isEmpty={activeVisualState === 'warning'}
            actionSlideIds={selection.actionSlideIds(activeSlide.id)}
            onSelect={(extendRange) => { handleSelect(activeSlideIndex, extendRange); }}
            overlay
          />
        ) : null}
      >
        <VirtualizedList
          getScrollElement={getScrollElement}
          estimateSize={160}
          activeIndex={state.currentSlideIndex}
          retainedIndexes={activeSlideIndex === -1 ? [] : [activeSlideIndex]}
          itemGap={12}
          scrollToIndexRef={virtualScrollToIndexRef}
          className="min-w-0 isolate"
          role="grid"
          aria-label={`Current ${state.currentItemRef?.type === 'lyric' ? 'lyrics' : 'slides'}`}
        >
          {slides.map((slide, index) => (
            <ItemEditorSlideListItem
              key={slide.id}
              slide={slide}
              index={index}
              isSelected={selection.selectedSlideIds.size === 0 ? index === state.currentSlideIndex : selection.selectedSlideIds.has(slide.id)}
              actionSlideIds={selection.actionSlideIds(slide.id)}
              onSelect={(extendRange) => handleSelect(index, extendRange)}
            />
          ))}
        </VirtualizedList>
      </SortableList.Root>
    </SlideTagManagerProvider>
  );
}
