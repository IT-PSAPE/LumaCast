import { useCallback } from 'react';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { useItemEditorScreen } from './screen-context';
import { ItemEditorSlideListItem } from './item-editor-slide-list-item';

const slideId = (slide: ReturnType<typeof useItemEditorScreen>['state']['slides'][number]) => slide.id;

export function ItemEditorSlideList() {
  const { state, actions } = useItemEditorScreen();

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

  return (
    <SortableList.Root {...dnd}>
      <div
        className="grid min-w-0 grid-cols-1 content-start gap-3"
        role="grid"
        aria-label={`Current ${state.currentItemRef?.type === 'lyric' ? 'lyrics' : 'slides'}`}
      >
        {slides.map((slide, index) => (
          <ItemEditorSlideListItem key={slide.id} slide={slide} index={index} />
        ))}
      </div>
    </SortableList.Root>
  );
}
