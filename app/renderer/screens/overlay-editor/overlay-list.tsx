import { useCallback } from 'react';
import { SortableList, useSortableOrder, type SortableOrderCommit } from '@renderer/components/layout/sortable-list';
import { useOverlayEditor } from '@renderer/contexts/asset-editor/asset-editor-context';
import { useOverlayEditorScreen } from './screen-context';
import { OverlayListItem } from './overlay-list-item';

const overlayId = (overlay: ReturnType<typeof useOverlayEditorScreen>['state']['overlays'][number]) => overlay.id;

export function OverlayList() {
  const { state } = useOverlayEditorScreen();
  const { reorderOverlay } = useOverlayEditor();

  const commitReorder = useCallback(
    // Unguarded: a rejection is what reverts the optimistic order.
    ({ id, toIndex }: SortableOrderCommit) => reorderOverlay(id, toIndex),
    [reorderOverlay],
  );

  const { items: overlays, dnd } = useSortableOrder({
    items: state.overlays,
    getId: overlayId,
    commit: commitReorder,
  });

  return (
    <SortableList.Root {...dnd}>
      <div className="grid min-w-0 grid-cols-1 content-start gap-1" role="grid" aria-label="Library overlays">
        {overlays.map((overlay, index) => (
          <OverlayListItem key={overlay.id} overlay={overlay} index={index} isActive={state.currentOverlayId === overlay.id} />
        ))}
      </div>
    </SortableList.Root>
  );
}
