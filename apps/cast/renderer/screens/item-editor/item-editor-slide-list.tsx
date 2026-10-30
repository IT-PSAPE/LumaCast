import { useCallback, useMemo, useRef } from 'react';
import { SortableList, useSortableOrder, VIRTUALIZED_SORTABLE_MEASURING } from '@renderer/components/layout/sortable-list';
import { VirtualizedList } from '@renderer/components/layout/virtualized-list';
import { useItemEditorScreen } from './screen-context';
import { getSlideVisualState } from '../../utils/slides';
import { ItemEditorSlideListItem } from './item-editor-slide-list-item';
import { SlideTile } from './slide-tile';
import { useSlideRangeSelection } from '../../hooks/use-slide-range-selection';
import { SlideTagManagerProvider } from '../../features/items/slide-tag-manager';
import { persistSlideReorder } from '../../features/items/use-slide-reorder';
import { useSlideBulkActions } from '../../features/items/use-slide-bulk-actions';
import { useSlideSelectionKeyboard } from '../../hooks/use-slide-selection-keyboard';

const slideId = (slide: ReturnType<typeof useItemEditorScreen>['state']['slides'][number]) => slide.id;

export function ItemEditorSlideList({ getScrollElement }: { getScrollElement: () => HTMLDivElement | null }) {
  const { state, actions } = useItemEditorScreen();
  const virtualScrollToIndexRef = useRef<((index: number) => void) | null>(null);
  const scrollToIndex = useCallback((index: number) => {
    virtualScrollToIndexRef.current?.(index);
  }, []);
  const slideIds = useMemo(() => state.slides.map(slideId), [state.slides]);
  const selection = useSlideRangeSelection(
    slideIds,
    state.currentSlideIndex,
    state.currentItemRef ? `${state.currentItemRef.type}:${state.currentItemRef.id}` : null,
  );
  const authoredSlideIds = useMemo(() => state.slides.filter((slide) => !slide.runtimeBlank).map((slide) => slide.id), [state.slides]);
  const keyboardActionSlideIds = useMemo(() => selection.selectedSlideIds.size > 0
    ? authoredSlideIds.filter((id) => selection.selectedSlideIds.has(id))
    : state.slides[state.currentSlideIndex] && !state.slides[state.currentSlideIndex].runtimeBlank
      ? [state.slides[state.currentSlideIndex].id]
      : [], [authoredSlideIds, selection.selectedSlideIds, state.currentSlideIndex, state.slides]);
  const bulkActions = useSlideBulkActions({
    slides: state.slides,
    duplicateSlide: actions.duplicateSlide,
    deleteSlide: actions.deleteSlide,
  });
  const handleSelectionKeys = useSlideSelectionKeyboard({
    selectAll: () => selection.selectAll(authoredSlideIds),
    clearSelection: selection.clearSelection,
    duplicateSelected: () => bulkActions.duplicateSlides(keyboardActionSlideIds),
    deleteSelected: () => bulkActions.deleteSlides(keyboardActionSlideIds),
  });
  const selectedIds = useMemo(() => new Set(state.slides
    .filter((slide) => !slide.runtimeBlank && selection.selectedSlideIds.has(slide.id))
    .map((slide) => slide.id)), [selection.selectedSlideIds, state.slides]);
  const currentSlideId = state.slides[state.currentSlideIndex]?.id ?? null;
  const commitReorder = useCallback((change: Parameters<typeof persistSlideReorder>[0]) => (
    // Unguarded: a rejection (slide deleted mid-drag, #214) is what reverts the
    // optimistic order in useSortableOrder.
    persistSlideReorder(
      change,
      slideIds,
      actions.reorderSlide,
      currentSlideId,
      actions.setCurrentSlideIndex,
    )
  ), [actions.reorderSlide, actions.setCurrentSlideIndex, currentSlideId, slideIds]);

  const { items: slides, dnd } = useSortableOrder({
    items: state.slides,
    getId: slideId,
    commit: commitReorder,
    selectedIds,
  });
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

  function handleSelect(index: number, extendRange: boolean, toggleSelection = false) {
    selection.selectSlide(index, extendRange, toggleSelection);
    if (extendRange || toggleSelection) return;
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
            onSelect={(extendRange, toggleSelection) => { handleSelect(activeSlideIndex, extendRange, toggleSelection); }}
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
          onKeyDown={handleSelectionKeys}
        >
          {slides.map((slide, index) => (
            <ItemEditorSlideListItem
              key={slide.id}
              slide={slide}
              index={index}
              isSelected={selection.selectedSlideIds.size === 0 ? index === state.currentSlideIndex : selection.selectedSlideIds.has(slide.id)}
              actionSlideIds={selection.actionSlideIds(slide.id)}
              onSelect={(extendRange, toggleSelection) => handleSelect(index, extendRange, toggleSelection)}
            />
          ))}
        </VirtualizedList>
      </SortableList.Root>
    </SlideTagManagerProvider>
  );
}
