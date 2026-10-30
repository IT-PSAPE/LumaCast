import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import { useEffect, useRef } from 'react';
import type { PlaylistSeparator } from '@lumacast/composition';
import { useNavigation } from '../../contexts/navigation-context';
import { RenameField, type RenameFieldHandle } from '../../components/form/rename-field';
import { ContextMenu, useContextMenuTrigger, useConfirm } from '@lumacast/ui';
import { getSeparatorColors, SEPARATOR_COLOR_OPTIONS } from './separator-color';
import type { RowDragProps } from './row-drag-props';
import type { PlaylistRowSelectionProps } from './row-selection-props';

interface SeparatorRowBodyProps extends RowDragProps, PlaylistRowSelectionProps {
  row: PlaylistSeparator;
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: CSSProperties;
  dragging?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  overlay?: boolean;
}

export function SeparatorRowBody({
  row,
  onDragOver,
  onDrop,
  containerRef,
  containerStyle,
  dragging = false,
  dragHandleProps,
  overlay = false,
  isMultiSelected = false,
  actionRows,
  onSelectionClick,
  onRemoveRows,
  onMoveRows,
}: SeparatorRowBodyProps) {
  const { currentPlaylistRows, movePlaylistRow, removePlaylistRow, renameSeparator, setSeparatorColor, recentlyCreatedId, clearRecentlyCreated } = useNavigation();
  const confirm = useConfirm();
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({
    disabled: overlay,
    onDelete: overlay ? undefined : () => {
      if (actionRows && actionRows.length > 1) void onRemoveRows?.(actionRows);
      else void handleDelete();
    },
  });
  const colors = getSeparatorColors(row.id, row.colorKey);

  const index = currentPlaylistRows.findIndex((candidate) => candidate.id === row.id);
  const isFirst = index <= 0;
  const isLast = index === -1 || index === currentPlaylistRows.length - 1;
  const isEditing = !overlay && row.id === recentlyCreatedId;
  const targets = actionRows?.length ? actionRows : [row];
  const isGroup = targets.length > 1;

  useEffect(() => {
    if (isEditing) renameRef.current?.startEditing();
  }, [isEditing]);

  function handleRename(name: string) {
    void renameSeparator(row.id, name).catch(() => undefined);
    clearRecentlyCreated();
  }

  function handleClick(event: React.MouseEvent<HTMLElement>) {
    onSelectionClick?.(row.id, event);
  }

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${row.label}"?`,
      description: 'This removes the separator from the playlist. The items around it stay.',
      confirmLabel: 'Delete',
      tone: 'danger',
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
          {...dragHandleProps}
          ref={triggerRef}
          className={`${dragging
            ? 'flex h-7 shrink-0 cursor-grabbing items-center gap-1 rounded-control px-2 shadow-lg'
            : 'flex h-7 shrink-0 cursor-grab items-center gap-1 rounded-control px-2 active:cursor-grabbing'}${isMultiSelected ? ' ring-2 ring-brand ring-inset' : ''}`}
          style={{ backgroundColor: colors.backgroundColor, color: colors.textColor }}
          onClick={overlay ? undefined : handleClick}
          onDragOver={overlay ? undefined : onDragOver}
          onDrop={overlay ? undefined : onDrop}
        >
          <RenameField
            ref={renameRef}
            value={row.label}
            onValueChange={handleRename}
            enabled={!overlay}
            className="label-xs flex-1"
          />
        </div>
      </div>
      {!overlay ? (
        <ContextMenu.Portal>
          <ContextMenu.Menu>
            {isGroup ? (
              <>
                <ContextMenu.Item onSelect={() => { void onMoveRows?.(targets, 'up'); }}>Move up</ContextMenu.Item>
                <ContextMenu.Item onSelect={() => { void onMoveRows?.(targets, 'down'); }}>Move down</ContextMenu.Item>
                <ContextMenu.Separator />
                <ContextMenu.Item variant="destructive" onSelect={() => { void onRemoveRows?.(targets); }}>
                  Remove {targets.length} rows from playlist
                </ContextMenu.Item>
              </>
            ) : (
              <>
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
                    <span className="inline-block size-3 shrink-0 rounded-control border border-secondary bg-transparent" aria-hidden />
                    <span>Default</span>
                  </ContextMenu.Item>
                  <ContextMenu.Separator />
                  {SEPARATOR_COLOR_OPTIONS.map((option) => {
                    const isActive = row.colorKey === option.key;
                    return (
                      <ContextMenu.Item key={option.key} onSelect={() => { void setSeparatorColor(row.id, option.key); }}>
                        <span
                          className="inline-block size-3 shrink-0 rounded-control border border-secondary"
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
              </>
            )}
          </ContextMenu.Menu>
        </ContextMenu.Portal>
      ) : null}
    </>
  );
}
