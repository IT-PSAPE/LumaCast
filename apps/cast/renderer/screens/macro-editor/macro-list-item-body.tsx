import { Workflow } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Id } from '@lumacast/kernel';
import { Thumbnail } from '@renderer/components/display/thumbnail';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { ContextMenu, useContextMenuTrigger } from '@lumacast/ui';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import type { useMultiSelection } from '@lumacast/selection';
import type { Macro } from '@lumacast/automation';

interface MacroListItemBodyProps {
  macro: Macro;
  isActive: boolean;
  selection: ReturnType<typeof useMultiSelection>;
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDuplicateMany: (ids: Id[]) => void;
  onDeleteMany: (ids: Id[]) => void;
}

export function MacroListItemBody({ macro, isActive, selection, onSelect, onContextMenu, onDuplicate, onDelete, onDuplicateMany, onDeleteMany }: MacroListItemBodyProps) {
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive);
  const { ref: triggerRef, onContextMenu: triggerContextMenu, ...triggerHandlers } = useContextMenuTrigger();
  const { containerRef, containerStyle, handleProps } = useSortableItem(macro.id);
  const selectedCount = selection.actionIds(macro.id).length;

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    onContextMenu(event);
    triggerContextMenu(event);
  }

  function handleDuplicate() {
    const ids = selection.actionIds(macro.id);
    if (ids.length > 1) onDuplicateMany(ids);
    else onDuplicate();
  }

  function handleDelete() {
    const ids = selection.actionIds(macro.id);
    if (ids.length > 1) onDeleteMany(ids);
    else onDelete();
  }

  return (
    <>
      <Thumbnail.Tile
        {...triggerHandlers}
        {...handleProps}
        ref={(node) => {
          activeRef.current = node;
          triggerRef(node);
          containerRef(node);
        }}
        style={containerStyle}
        className="cursor-grab active:cursor-grabbing"
        onClick={onSelect}
        onContextMenu={handleContextMenu}
        aria-selected={selection.selectedIds.has(macro.id)}
        selected={isActive || selection.selectedIds.has(macro.id)}
      >
        <Thumbnail.Body>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-tertiary text-secondary">
            <Workflow className="size-6" strokeWidth={1.5} />
          </div>
        </Thumbnail.Body>
        <Thumbnail.Caption>
          <span className="min-w-0 truncate text-sm text-tertiary">{macro.name}</span>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={handleDuplicate}>{selectedCount > 1 ? `Duplicate ${selectedCount} macros` : 'Duplicate'}</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={handleDelete}>{selectedCount > 1 ? `Delete ${selectedCount} macros` : 'Delete'}</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
