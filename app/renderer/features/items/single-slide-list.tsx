import { useCallback, useRef } from 'react';
import { useSlides } from '../../contexts/slide-context';
import { useThumbnailScene } from '../../contexts/canvas/canvas-context';
import { useOutlineView } from './use-slide-list-view';
import { SortableList, useSortableOrder, VIRTUALIZED_SORTABLE_MEASURING } from '@renderer/components/layout/sortable-list';
import { EmptyState } from '@renderer/components/display/empty-state';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { SlideOutlineRow } from './slide-list-row';
import { SortableSlideOutlineRow } from './sortable-slide-outline-row';
import { outlineRowId, useSlideReorderCommit } from './use-slide-reorder';
import { VirtualizedList } from '@renderer/components/layout/virtualized-list';

export function SingleSlideList() {
  const { rows: persistedRows, currentSlideIndex, selectSlide, openSlide, updateText } = useOutlineView();
  const { reorderSlide } = useSlides();
  const getThumbnailScene = useThumbnailScene();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const virtualScrollToIndexRef = useRef<((index: number) => void) | null>(null);
  const getScrollElement = useCallback(() => viewportRef.current, []);
  const scrollToIndex = useCallback((index: number) => {
    virtualScrollToIndexRef.current?.(index);
  }, []);
  const { items: rows, dnd } = useSortableOrder({
    items: persistedRows,
    getId: outlineRowId,
    commit: useSlideReorderCommit(reorderSlide),
  });
  const activeRowIndex = dnd.activeId ? rows.findIndex((row) => row.slide.id === dnd.activeId) : -1;
  const activeRow = activeRowIndex === -1 ? null : rows[activeRowIndex];
  const activeScene = activeRow ? getThumbnailScene(activeRow.slide.id, 'list') : null;

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
      <ScrollArea.Viewport ref={viewportRef} className="p-2">
        <SortableList.Root
          {...dnd}
          measuring={VIRTUALIZED_SORTABLE_MEASURING}
          activeId={dnd.activeId}
          virtualizedKeyboard={{
            onMoveToIndex: dnd.onKeyboardMoveToIndex,
            scrollToIndex,
          }}
          dragOverlay={activeRow && activeScene ? (
            <SlideOutlineRow
              row={activeRow}
              scene={activeScene}
              isFocused={activeRow.index === currentSlideIndex}
              onSelect={selectSlide}
              onOpen={openSlide}
              onTextCommit={updateText}
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
