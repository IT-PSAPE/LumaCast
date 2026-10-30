import { useCallback, useMemo, useRef } from 'react';
import { useSlides } from '../../contexts/slide-context';
import { useThumbnailScene } from '../../contexts/canvas/canvas-context';
import { useOutlineView } from './use-slide-list-view';
import { SortableList, useSortableOrder, VIRTUALIZED_SORTABLE_MEASURING } from '@renderer/components/layout/sortable-list';
import { EmptyState } from '@lumacast/ui';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { SlideOutlineRow } from './slide-list-row';
import { SortableSlideOutlineRow } from './sortable-slide-outline-row';
import { outlineRowId, useSlideReorderCommit } from './use-slide-reorder';
import { VirtualizedList } from '@renderer/components/layout/virtualized-list';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlideRangeSelection } from '../../hooks/use-slide-range-selection';
import { useSlideSelectionKeyboard } from '../../hooks/use-slide-selection-keyboard';
import { useSlideBulkActions } from './use-slide-bulk-actions';

export function SingleSlideList() {
  const { rows: persistedRows, currentSlideIndex, selectSlide, openSlide } = useOutlineView();
  const { reorderSlide, setCurrentSlideIndex, duplicateSlide, deleteSlide } = useSlides();
  const { currentItemRef } = useNavigation();
  const getThumbnailScene = useThumbnailScene();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const virtualScrollToIndexRef = useRef<((index: number) => void) | null>(null);
  const getScrollElement = useCallback(() => viewportRef.current, []);
  const scrollToIndex = useCallback((index: number) => {
    virtualScrollToIndexRef.current?.(index);
  }, []);
  const slideIds = useMemo(() => persistedRows.map((row) => row.slide.id), [persistedRows]);
  const selection = useSlideRangeSelection(
    slideIds,
    currentSlideIndex,
    currentItemRef ? `${currentItemRef.type}:${currentItemRef.id}` : null,
  );
  const authoredSlideIds = useMemo(() => persistedRows
    .filter((row) => !row.slide.runtimeBlank)
    .map((row) => row.slide.id), [persistedRows]);
  const slides = useMemo(() => persistedRows.map((row) => row.slide), [persistedRows]);
  const keyboardActionSlideIds = useMemo(() => selection.selectedSlideIds.size > 0
    ? authoredSlideIds.filter((id) => selection.selectedSlideIds.has(id))
    : persistedRows[currentSlideIndex] && !persistedRows[currentSlideIndex].slide.runtimeBlank
      ? [persistedRows[currentSlideIndex].slide.id]
      : [], [authoredSlideIds, currentSlideIndex, persistedRows, selection.selectedSlideIds]);
  const bulkActions = useSlideBulkActions({ slides, duplicateSlide, deleteSlide });
  const handleSelectionKeys = useSlideSelectionKeyboard({
    selectAll: () => selection.selectAll(authoredSlideIds),
    clearSelection: selection.clearSelection,
    duplicateSelected: () => bulkActions.duplicateSlides(keyboardActionSlideIds),
    deleteSelected: () => bulkActions.deleteSlides(keyboardActionSlideIds),
  });
  const selectedIds = useMemo(() => new Set(persistedRows
    .filter((row) => !row.slide.runtimeBlank && selection.selectedSlideIds.has(row.slide.id))
    .map((row) => row.slide.id)), [persistedRows, selection.selectedSlideIds]);
  const currentSlideId = persistedRows[currentSlideIndex]?.slide.id ?? null;
  const { items: rows, dnd } = useSortableOrder({
    items: persistedRows,
    getId: outlineRowId,
    commit: useSlideReorderCommit(slideIds, reorderSlide, currentSlideId, setCurrentSlideIndex),
    selectedIds,
  });
  const activeRowIndex = dnd.activeId ? rows.findIndex((row) => row.slide.id === dnd.activeId) : -1;
  const activeRow = activeRowIndex === -1 ? null : rows[activeRowIndex];
  const activeScene = activeRow ? getThumbnailScene(activeRow.slide.id, 'list') : null;
  const onKeyboardMoveToIndex = useCallback((index: number) => {
    if (rows[index]?.slide.runtimeBlank) return;
    dnd.onKeyboardMoveToIndex(index);
  }, [dnd.onKeyboardMoveToIndex, rows]);

  function renderRow(row: (typeof rows)[number]) {
    const scene = getThumbnailScene(row.slide.id, 'list');
    if (!scene) return null;
    return (
      <SortableSlideOutlineRow
        key={row.slide.id}
        row={row}
        scene={scene}
        isFocused={row.index === currentSlideIndex}
        isSelected={selection.selectedSlideIds.size === 0 ? row.index === currentSlideIndex : selection.selectedSlideIds.has(row.slide.id)}
        onSelect={selectSlide}
        onOpen={openSlide}
        onRangeSelect={selection.selectSlide}
        actionSlideIds={selection.actionSlideIds(row.slide.id)}
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
      <ScrollArea.Viewport ref={viewportRef} className="p-2" onKeyDown={handleSelectionKeys}>
        <SortableList.Root
          {...dnd}
          measuring={VIRTUALIZED_SORTABLE_MEASURING}
          activeId={dnd.activeId}
          virtualizedKeyboard={{
            onMoveToIndex: onKeyboardMoveToIndex,
            scrollToIndex,
          }}
          dragOverlay={activeRow && activeScene ? (
            <SlideOutlineRow
              row={activeRow}
              scene={activeScene}
              isFocused={activeRow.index === currentSlideIndex}
              isSelected={selection.selectedSlideIds.has(activeRow.slide.id)}
              onSelect={selectSlide}
              onOpen={openSlide}
              onRangeSelect={selection.selectSlide}
              actionSlideIds={selection.actionSlideIds(activeRow.slide.id)}
              overlay
            />
          ) : null}
        >
          <VirtualizedList
            getScrollElement={getScrollElement}
            estimateSize={56}
            activeIndex={currentSlideIndex}
            retainedIndexes={activeRowIndex === -1 ? [] : [activeRowIndex]}
            itemGap={12}
            scrollToIndexRef={virtualScrollToIndexRef}
            className="isolate"
            role="list"
            aria-label="Slide outline"
          >
            {rows.map(renderRow)}
          </VirtualizedList>
        </SortableList.Root>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar>
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
