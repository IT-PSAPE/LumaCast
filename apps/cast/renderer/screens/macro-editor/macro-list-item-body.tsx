import { Workflow } from 'lucide-react';
import { Thumbnail } from '@renderer/components/display/thumbnail';
import { useScrollAreaActiveItem } from '@renderer/components/layout/scroll-area';
import { ContextMenu, useContextMenuTrigger } from '@renderer/components/overlays/context-menu';
import { useSortableItem } from '@renderer/components/layout/sortable-list';
import type { Macro } from '@lumacast/automation';

interface MacroListItemBodyProps {
  macro: Macro;
  index: number;
  isActive: boolean;
  onSelect: (id: Macro['id']) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function MacroListItemBody({ macro, index, isActive, onSelect, onDuplicate, onDelete }: MacroListItemBodyProps) {
  const activeRef = useScrollAreaActiveItem<HTMLDivElement>(isActive);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();
  const { containerRef, containerStyle, handleProps } = useSortableItem(macro.id);
  const cueCountLabel = `${macro.cues.length} ${macro.cues.length === 1 ? 'cue' : 'cues'}`;

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
        onClick={() => onSelect(macro.id)}
        selected={isActive}
      >
        <Thumbnail.Body>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-tertiary text-secondary">
            <Workflow className="size-6" strokeWidth={1.5} />
            <span className="text-xs text-tertiary">{cueCountLabel}</span>
          </div>
        </Thumbnail.Body>
        <Thumbnail.Caption>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-semibold tabular-nums text-secondary">{index + 1}</span>
            <span className="min-w-0 truncate text-sm text-tertiary">{macro.name}</span>
          </div>
        </Thumbnail.Caption>
      </Thumbnail.Tile>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={onDuplicate}>Duplicate</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={onDelete}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
