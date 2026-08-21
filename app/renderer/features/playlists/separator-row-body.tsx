import { useEffect, useRef } from 'react';
import type { PlaylistSeparator } from '@lumacast/composition';
import { useNavigation } from '../../contexts/navigation-context';
import { RenameField, type RenameFieldHandle } from '../../components/form/rename-field';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { useSortableItem } from '../../components/layout/sortable-list';
import { getSeparatorColors, SEPARATOR_COLOR_OPTIONS } from './separator-color';
import type { RowDragProps } from './row-drag-props';

export function SeparatorRowBody({ row, onDragOver, onDrop }: { row: PlaylistSeparator } & RowDragProps) {
  const { currentPlaylistRows, movePlaylistRow, removePlaylistRow, renameSeparator, setSeparatorColor, recentlyCreatedId, clearRecentlyCreated } = useNavigation();
  const confirm = useConfirm();
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();
  const { containerRef, containerStyle, handleProps } = useSortableItem(row.id);
  const colors = getSeparatorColors(row.id, row.colorKey);

  const index = currentPlaylistRows.findIndex((candidate) => candidate.id === row.id);
  const isFirst = index <= 0;
  const isLast = index === -1 || index === currentPlaylistRows.length - 1;
  const isEditing = row.id === recentlyCreatedId;

  useEffect(() => {
    if (isEditing) renameRef.current?.startEditing();
  }, [isEditing]);

  function handleRename(name: string) {
    void renameSeparator(row.id, name).catch(() => undefined);
    clearRecentlyCreated();
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${row.label}"?`,
      description: 'This removes the separator from the playlist. The items around it stay.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    // removePlaylistRow rejects when the row no longer exists (#214), which a
    // context-menu action can race with a concurrent delete. mutatePatch has
    // already reported the failure, so absorb the rethrow here.
    if (ok) await removePlaylistRow(row.id).catch(() => undefined);
  }

  return (
    <>
      <div ref={containerRef} style={containerStyle}>
        <div
          {...triggerHandlers}
          {...handleProps}
          ref={triggerRef}
          className="flex h-7 shrink-0 cursor-grab items-center gap-1 rounded-xs px-2 active:cursor-grabbing"
          style={{ backgroundColor: colors.backgroundColor, color: colors.textColor }}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <RenameField ref={renameRef} value={row.label} onValueChange={handleRename} className="label-xs flex-1" />
        </div>
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item disabled={isFirst} onSelect={() => {
            // movePlaylistRow rejects when the row no longer exists (#214),
            // which a context-menu action can race with a concurrent delete.
            // mutatePatch has already reported the failure, so absorb the
            // rethrow here.
            void movePlaylistRow(row.id, index - 1).catch(() => undefined);
          }}>Move up</ContextMenu.Item>
          <ContextMenu.Item disabled={isLast} onSelect={() => {
            // See "Move up" above: same race, same absorption.
            void movePlaylistRow(row.id, index + 1).catch(() => undefined);
          }}>Move down</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Submenu label="Color">
            <ContextMenu.Item onSelect={() => { void setSeparatorColor(row.id, null); }}>
              <span className="inline-block size-3 shrink-0 rounded-sm border border-secondary bg-transparent" aria-hidden />
              <span>Default</span>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            {SEPARATOR_COLOR_OPTIONS.map((option) => {
              const isActive = row.colorKey === option.key;
              return (
                <ContextMenu.Item key={option.key} onSelect={() => { void setSeparatorColor(row.id, option.key); }}>
                  <span
                    className="inline-block size-3 shrink-0 rounded-sm border border-secondary"
                    style={{ backgroundColor: option.swatch }}
                    aria-hidden
                  />
                  <span className="flex-1">{option.label}</span>
                  {isActive ? <span aria-hidden className="text-tertiary">✓</span> : null}
                </ContextMenu.Item>
              );
            })}
          </ContextMenu.Submenu>
          <ContextMenu.Separator />
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleDelete(); }}>Delete</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}
