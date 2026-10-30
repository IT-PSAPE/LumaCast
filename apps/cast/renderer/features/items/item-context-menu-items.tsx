import type { ItemRef } from '@lumacast/composition';
import type { RenameFieldHandle } from '@renderer/components/form/rename-field';
import { ContextMenu } from '@lumacast/ui';
import { LyricItemBlankSlidesMenu } from './lyric-blank-slides-menu';

export function ItemContextMenuItems({ itemRef, renameRef, isFirst, isLast, onMove, onDelete, onDuplicate, actionItemRefs, onDeleteItems, onMoveItems }: {
  itemRef: ItemRef;
  renameRef: React.RefObject<RenameFieldHandle | null>;
  isFirst: boolean;
  isLast: boolean;
  onMove: (itemRef: ItemRef, direction: 'up' | 'down') => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  actionItemRefs?: ItemRef[];
  onDeleteItems?: (itemRefs: readonly ItemRef[]) => void | Promise<void>;
  onMoveItems?: (itemRefs: readonly ItemRef[], direction: 'up' | 'down') => void | Promise<void>;
}) {
  const targets = actionItemRefs?.length ? actionItemRefs : [itemRef];
  const isGroup = targets.length > 1;

  return (
    <ContextMenu.Portal>
      <ContextMenu.Menu>
        {isGroup ? (
          <>
            <ContextMenu.Item onSelect={() => { void onMoveItems?.(targets, 'up'); }}>Move up</ContextMenu.Item>
            <ContextMenu.Item onSelect={() => { void onMoveItems?.(targets, 'down'); }}>Move down</ContextMenu.Item>
          </>
        ) : (
          <>
            <ContextMenu.Item disabled={isFirst} onSelect={() => onMove(itemRef, 'up')}>Move up</ContextMenu.Item>
            <ContextMenu.Item disabled={isLast} onSelect={() => onMove(itemRef, 'down')}>Move down</ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
            {onDuplicate && <ContextMenu.Item onSelect={onDuplicate}>Duplicate</ContextMenu.Item>}
            {itemRef.type === 'lyric' ? <LyricItemBlankSlidesMenu lyricId={itemRef.id} /> : null}
          </>
        )}
        <ContextMenu.Separator />
        <ContextMenu.Item
          variant="destructive"
          onSelect={() => {
            if (isGroup) void onDeleteItems?.(targets);
            else onDelete();
          }}
        >
          {isGroup ? `Delete ${targets.length} items` : 'Delete'}
        </ContextMenu.Item>
      </ContextMenu.Menu>
    </ContextMenu.Portal>
  );
}
