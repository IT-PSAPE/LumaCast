import type { ItemRef } from '@lumacast/composition';
import type { RenameFieldHandle } from '@renderer/components/form/rename-field';
import { ContextMenu } from '../../components/overlays/context-menu';

export function ItemContextMenuItems({ itemRef, renameRef, isFirst, isLast, onMove, onDelete, onDuplicate }: {
  itemRef: ItemRef;
  renameRef: React.RefObject<RenameFieldHandle | null>;
  isFirst: boolean;
  isLast: boolean;
  onMove: (itemRef: ItemRef, direction: 'up' | 'down') => void;
  onDelete: () => void;
  onDuplicate?: () => void;
}) {
  return (
    <ContextMenu.Portal>
      <ContextMenu.Menu>
        <ContextMenu.Item disabled={isFirst} onSelect={() => onMove(itemRef, 'up')}>Move up</ContextMenu.Item>
        <ContextMenu.Item disabled={isLast} onSelect={() => onMove(itemRef, 'down')}>Move down</ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
        {onDuplicate && <ContextMenu.Item onSelect={onDuplicate}>Duplicate</ContextMenu.Item>}
        <ContextMenu.Separator />
        <ContextMenu.Item variant="destructive" onSelect={onDelete}>Delete</ContextMenu.Item>
      </ContextMenu.Menu>
    </ContextMenu.Portal>
  );
}
