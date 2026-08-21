import { useEffect, useRef } from 'react';
import { ItemIcon } from '../../components/display/entity-icon';
import { SelectableRow } from '../../components/display/selectable-row';
import { RenameField, type RenameFieldHandle } from '../../components/form/rename-field';
import { useContextMenuTrigger } from '../../components/overlays/context-menu';
import { writeItemDragData } from '../../utils/item-drag';
import type { ItemLike, ItemProps } from './item-bin-types';
import { ItemContextMenuItems } from './item-context-menu-items';
import { useDeleteItem } from './use-delete-item';
import { useDuplicateItem } from './use-duplicate-item';

export function ItemBinRowBody<T extends ItemLike>({ item, itemRef, slides, isSelected, isEditing, isFirst, isLast, onOpen, onRename, onMove }: ItemProps<T>) {
  const renameRef = useRef<RenameFieldHandle>(null);
  const handleDelete = useDeleteItem(itemRef, item.title);
  const handleDuplicate = useDuplicateItem(itemRef, item.title);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete(); } });

  useEffect(() => {
    if (isEditing) renameRef.current?.startEditing();
  }, [isEditing]);

  function handleOpen() {
    onOpen(itemRef);
  }

  function handleDragStart(event: React.DragEvent<HTMLElement>) {
    writeItemDragData(event.dataTransfer, itemRef);
  }

  function handleRename(title: string) {
    onRename(itemRef, title);
  }

  return (
    <>
      <SelectableRow.Root
        {...triggerHandlers}
        ref={triggerRef}
        selected={isSelected}
        onClick={handleOpen}
        className="h-9 cursor-grab focus-visible:ring-2 focus-visible:ring-brand"
        draggable
        onDragStart={handleDragStart}
      >
        <SelectableRow.Leading>
          <ItemIcon entity={itemRef} size={14} strokeWidth={1.75} />
        </SelectableRow.Leading>
        <SelectableRow.Label>
          <RenameField ref={renameRef} value={item.title} onValueChange={handleRename} className="label-xs" />
        </SelectableRow.Label>
        <SelectableRow.Trailing>
          <span className="text-xs text-tertiary">{slides.length} {slides.length === 1 ? 'slide' : 'slides'}</span>
        </SelectableRow.Trailing>
      </SelectableRow.Root>
      <ItemContextMenuItems
        itemRef={itemRef}
        renameRef={renameRef}
        isFirst={isFirst}
        isLast={isLast}
        onMove={onMove}
        onDelete={() => { void handleDelete(); }}
        onDuplicate={handleDuplicate ? () => { void handleDuplicate(); } : undefined}
      />
    </>
  );
}
