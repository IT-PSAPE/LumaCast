import { useSlides } from '../../contexts/slide-context';
import { useRenderScenes } from '../../contexts/canvas/canvas-context';
import { useOutlineView } from './use-slide-list-view';
import { SortableList, useSortableOrder } from '@renderer/components/layout/sortable-list';
import { EmptyState } from '@renderer/components/display/empty-state';
import { ScrollArea } from '@renderer/components/layout/scroll-area';
import { SortableSlideOutlineRow } from './sortable-slide-outline-row';
import { outlineRowId, useSlideReorderCommit } from './use-slide-reorder';

export function SingleSlideList() {
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
