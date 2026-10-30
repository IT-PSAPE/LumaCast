import { useRef } from 'react';
import { Check, Play, Workflow } from 'lucide-react';
import type { Id } from '@lumacast/kernel';
import type { Macro } from '@lumacast/automation';
import { ContextMenu, useContextMenuTrigger } from '@lumacast/ui';
import { RenameField, type RenameFieldHandle } from '../../components/form/rename-field';
import { Thumbnail } from '../../components/display/thumbnail';
import type { SelectionModifiers } from '@lumacast/selection';

export interface MacroCardProps {
  macro: Macro;
  isSelected: boolean;
  isResourceSelected?: boolean;
  runsOnStartup: boolean;
  onSelect: (id: Id | null) => void;
  onSelectionClick?: (id: Id, modifiers: SelectionModifiers) => boolean;
  onContextMenuTarget?: (id: Id) => void;
  onOpen: (id: Id) => void;
  onRunMacro: (id: Id) => Promise<void>;
  onDeleteMacro: (id: Id) => Promise<void>;
  onDuplicateMacro: (id: Id) => Promise<unknown> | unknown;
  onToggleRunOnStartup: (id: Id) => Promise<void>;
  onRename: (next: string) => void;
}

export function MacroCardBody({ macro, isSelected, isResourceSelected, runsOnStartup, onSelect, onSelectionClick, onContextMenuTarget, onOpen, onRunMacro, onDeleteMacro, onDuplicateMacro, onToggleRunOnStartup, onRename }: MacroCardProps) {
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleDelete().catch(() => undefined); } });

  async function handleDelete() {
    // onDeleteMacro → deleteMacro rejects when the macro no longer exists
    // (#214), which a delete can race with a concurrent delete. mutatePatch has
    // already reported the failure, so absorb the rethrow here.
    await onDeleteMacro(macro.id).catch(() => undefined);
  }

  function handleSelect(event: React.MouseEvent<HTMLDivElement>) {
    const modifiers = { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey };
    if (onSelectionClick?.(macro.id, modifiers)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onSelect(macro.id);
  }

  return (
    <>
      <div
        {...triggerHandlers}
        ref={triggerRef}
        onContextMenuCapture={() => onContextMenuTarget?.(macro.id)}
        onKeyDownCapture={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) onContextMenuTarget?.(macro.id);
        }}
        onTouchStartCapture={() => onContextMenuTarget?.(macro.id)}
        className="rounded-container focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Thumbnail.Tile
          onClick={handleSelect}
          onDoubleClick={(event) => {
            if (event.shiftKey || event.metaKey || event.ctrlKey) return;
            onOpen(macro.id);
          }}
          selected={isSelected || Boolean(isResourceSelected)}
        >
          <Thumbnail.Body>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-tertiary text-secondary">
              <Workflow className="size-7" strokeWidth={1.5} />
            </div>
          </Thumbnail.Body>
          <Thumbnail.Caption>
            <RenameField ref={renameRef} value={macro.name} onValueChange={onRename} className="label-xs" />
          </Thumbnail.Caption>
        </Thumbnail.Tile>
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item onSelect={() => onOpen(macro.id)}>Edit</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { void onDuplicateMacro(macro.id); }}>Duplicate</ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { void onRunMacro(macro.id); }}>
            <span className="inline-flex items-center gap-1.5">
              <Play className="size-3.5" />Run now
            </span>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={() => { void onToggleRunOnStartup(macro.id); }}>
            <span className="inline-flex items-center gap-1.5">
              {runsOnStartup ? <Check className="size-3.5" /> : <span className="inline-block size-3.5" />}
              Run on startup
            </span>
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete().catch(() => undefined); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
