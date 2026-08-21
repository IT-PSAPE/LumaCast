import type { PlaylistSeparator } from '@lumacast/composition';
import { ContextMenu } from '../../components/overlays/context-menu';
import { SeparatorRowBody } from './separator-row-body';
import type { RowDragProps } from './row-drag-props';

export function SeparatorRow({ row, onDragOver, onDrop }: { row: PlaylistSeparator } & RowDragProps) {
  return (
    <ContextMenu.Root>
      <SeparatorRowBody row={row} onDragOver={onDragOver} onDrop={onDrop} />
    </ContextMenu.Root>
  );
}
