import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import { useRef } from 'react';
import type { PlaylistItemEntry } from '@lumacast/composition';
import { getPlaylistEntryItemRef } from '@lumacast/composition';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { RenameField, type RenameFieldHandle } from '../../components/form/rename-field';
import { ItemIcon } from '../../components/display/entity-icon';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import type { RowDragProps } from './row-drag-props';

interface PlaylistItemRowBodyProps extends RowDragProps {
  row: PlaylistItemEntry;
  containerRef?: Ref<HTMLDivElement>;
  containerStyle?: CSSProperties;
  dragging?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  overlay?: boolean;
}

export function PlaylistItemRowBody({
  row,
  onDragOver,
  onDrop,
  containerRef,
  containerStyle,
  dragging = false,
  dragHandleProps,
  overlay = false,
}: PlaylistItemRowBodyProps) {
  const { currentPlaylistRows, currentPlaylistEntryId, renameItem, movePlaylistRow, removePlaylistRow } = useNavigation();
  const { selectPlaylistEntry } = useSlides();
  const { resolveItemRef } = useProjectContent();
  const confirm = useConfirm();
  const renameRef = useRef<RenameFieldHandle>(null);
  const itemRef = getPlaylistEntryItemRef(row);
  const item = resolveItemRef(itemRef);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({
    disabled: overlay,
    onDelete: overlay ? undefined : () => { void handleRemove(); },
  });

  const isSelected = row.id === currentPlaylistEntryId;
  const index = currentPlaylistRows.findIndex((candidate) => candidate.id === row.id);
  const isFirst = index <= 0;
  const isLast = index === -1 || index === currentPlaylistRows.length - 1;

  function handleSelect() { selectPlaylistEntry(row.id); }

  function handleRename(name: string) {
    // renameItem rejects when the item no longer exists (#214), which a
    // rename field commit can race with a concurrent delete. The failure has
    // already been reported by mutatePatch, so absorb the rethrow here.
    void renameItem(itemRef, name).catch(() => undefined);
  }

  async function handleRemove() {
    const ok = await confirm({
      title: `Remove "${item?.title ?? 'item'}" from playlist?`,
      description: 'The item itself is not deleted — only this playlist entry is removed.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    // removePlaylistRow rejects when the row no longer exists (#214), which
    // this context-menu action can race with a concurrent delete. mutatePatch
    // has already reported the failure, so absorb the rethrow here.
    if (ok) await removePlaylistRow(row.id).catch(() => undefined);
  }

  if (!item) return null;

  return (
    <>
      <div
        ref={containerRef}
        style={containerStyle}
      >
        <LumaCastPanel.MenuItem
          {...triggerHandlers}
          {...dragHandleProps}
          ref={triggerRef}
          active={isSelected}
          onClick={overlay ? undefined : handleSelect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={dragging
            ? 'my-0.5 cursor-grabbing shadow-lg focus-visible:ring-2 focus-visible:ring-brand'
            : 'my-0.5 cursor-grab focus-visible:ring-2 focus-visible:ring-brand active:cursor-grabbing'}
        >
          <ItemIcon entity={itemRef} className="shrink-0" />
          <RenameField ref={renameRef} value={item.title} onValueChange={handleRename} className="label-xs" />
        </LumaCastPanel.MenuItem>
      </div>
      {!overlay ? (
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
            <ContextMenu.Item variant="destructive" onSelect={() => { void handleRemove(); }}>Remove from playlist</ContextMenu.Item>
          </ContextMenu.Menu>
        </ContextMenu.Portal>
      ) : null}
    </>
  );
}
