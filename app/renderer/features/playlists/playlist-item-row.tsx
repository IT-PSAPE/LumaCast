import type { PlaylistItemEntry } from '@lumacast/composition';
import { ContextMenu } from '../../components/overlays/context-menu';
import { PlaylistItemRowBody } from './playlist-item-row-body';
import type { RowDragProps } from './row-drag-props';

export function PlaylistItemRow({ row, onDragOver, onDrop }: { row: PlaylistItemEntry } & RowDragProps) {
  return (
    <ContextMenu.Root>
      <PlaylistItemRowBody row={row} onDragOver={onDragOver} onDrop={onDrop} />
    </ContextMenu.Root>
  );
}
