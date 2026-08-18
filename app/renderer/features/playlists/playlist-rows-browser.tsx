import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Id } from '@lumacast/kernel';
import type { PlaylistItemEntry, PlaylistRow, PlaylistSeparator } from '@lumacast/composition';
import { getPlaylistEntryItemRef } from '@lumacast/composition';
import { ReacstButton } from '@renderer/components/controls/button';
import { RenameField, type RenameFieldHandle } from '@renderer/components/form/rename-field';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { ItemIcon } from '../../components/display/entity-icon';
import { ScrollArea } from '../../components/layout/scroll-area';
import { EmptyState } from '../../components/display/empty-state';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { Label } from '@renderer/components/display/text';
import { useNavigation } from '../../contexts/navigation-context';
import { useProjectContent } from '../../contexts/use-project-content';
import { useSlides } from '../../contexts/slide-context';
import { hasItemDragData, readItemDragData } from '../../utils/item-drag';
import { getSeparatorColors, SEPARATOR_COLOR_OPTIONS } from './separator-color';

// #219 item-model refactor decision D5/D9: replaces the accordion-of-groups
// browser — a playlist's rows are already flat and ordered, so this renders
// them straight through: a separator row is a plain non-collapsing divider,
// never a container, and sits as a sibling of the item rows around it.
export function PlaylistRowsBrowser() {
  const { currentPlaylistId, currentPlaylistRows, createSeparator } = useNavigation();

  function handleNewSeparator() { void createSeparator(); }

  if (!currentPlaylistId) {
    return <EmptyState.Root><EmptyState.Title>Select a playlist</EmptyState.Title></EmptyState.Root>;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <LumaCastPanel.Group>
        <LumaCastPanel.GroupTitle className='border-t'>
          <Label.xs className='mr-auto'>Items</Label.xs>
          <ReacstButton.Icon onClick={handleNewSeparator} aria-label="New separator" title="New separator">
            <Plus />
          </ReacstButton.Icon>
        </LumaCastPanel.GroupTitle>
      </LumaCastPanel.Group>

      <LumaCastPanel.Group className="flex-1 min-h-0">
        <ScrollArea.Root>
          <ScrollArea.Viewport>
            <PlaylistRowList rows={currentPlaylistRows} playlistId={currentPlaylistId} />
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar>
            <ScrollArea.Thumb />
          </ScrollArea.Scrollbar>
        </ScrollArea.Root>
      </LumaCastPanel.Group>
    </div>
  );
}

function PlaylistRowList({ rows, playlistId }: { rows: PlaylistRow[]; playlistId: Id }) {
  const { addItemToPlaylist } = useNavigation();
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Container handlers (empty content, end-of-list gap) only seed an initial
  // dropIndex when nothing is set yet — they never overwrite a value a
  // row-level handler already chose. Without this, positioning the indicator
  // on a specific row would snap back to the end the moment the cursor
  // crossed a gap between rows.
  function handleContainerDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!hasItemDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropIndex((prev) => prev ?? rows.length);
  }

  function handleRowDragOver(index: number, event: React.DragEvent<HTMLElement>) {
    if (!hasItemDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    const bounds = event.currentTarget.getBoundingClientRect();
    const isAfter = event.clientY > bounds.top + bounds.height / 2;
    setDropIndex(isAfter ? index + 1 : index);
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDropIndex(null);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    if (!hasItemDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();

    const itemRef = readItemDragData(event.dataTransfer);
    const nextDropIndex = dropIndex ?? rows.length;
    setDropIndex(null);
    if (!itemRef) return;

    // addItemToPlaylist rejects when the item no longer exists (#214), which
    // a drop can race. mutatePatch has already reported the failure, so
    // absorb the rethrow here.
    void addItemToPlaylist(playlistId, itemRef, nextDropIndex).catch(() => undefined);
  }

  if (rows.length === 0) {
    return (
      <div className="p-1" onDragOver={handleContainerDragOver} onDrop={handleDrop} onDragLeave={handleDragLeave}>
        <EmptyState.Root>
          <EmptyState.Title>No items yet</EmptyState.Title>
          <EmptyState.Description>Drag an item from the bin to add it here.</EmptyState.Description>
        </EmptyState.Root>
      </div>
    );
  }

  const nodes: React.ReactNode[] = [];
  rows.forEach((row, index) => {
    if (dropIndex === index) nodes.push(<DropIndicator key={`drop-${index}`} />);
    nodes.push(
      row.kind === 'separator'
        ? (
          <SeparatorRow
            key={row.id}
            row={row}
            onDragOver={(event) => handleRowDragOver(index, event)}
            onDrop={handleDrop}
          />
        )
        : (
          <PlaylistItemRow
            key={row.id}
            row={row}
            onDragOver={(event) => handleRowDragOver(index, event)}
            onDrop={handleDrop}
          />
        ),
    );
  });
  if (dropIndex === rows.length) nodes.push(<DropIndicator key="drop-end" />);

  return (
    <div className="flex flex-col gap-0.5 p-1" onDragOver={handleContainerDragOver} onDrop={handleDrop} onDragLeave={handleDragLeave}>
      {nodes}
    </div>
  );
}

interface RowDragProps {
  onDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onDrop: (event: React.DragEvent<HTMLElement>) => void;
}

function DropIndicator() {
  return (
    <div className="0px w-full overflow-visible relative !m-0">
      <div className="absolute inset-0 h-[2px] w-full bg-brand_solid -translate-y-1/2" />
    </div>
  );
}

function SeparatorRow({ row, onDragOver, onDrop }: { row: PlaylistSeparator } & RowDragProps) {
  return (
    <ContextMenu.Root>
      <SeparatorRowBody row={row} onDragOver={onDragOver} onDrop={onDrop} />
    </ContextMenu.Root>
  );
}

function SeparatorRowBody({ row, onDragOver, onDrop }: { row: PlaylistSeparator } & RowDragProps) {
  const { currentPlaylistRows, movePlaylistRow, removePlaylistRow, renameSeparator, setSeparatorColor, recentlyCreatedId, clearRecentlyCreated } = useNavigation();
  const confirm = useConfirm();
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();
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
      <div
        {...triggerHandlers}
        ref={triggerRef}
        className="flex h-7 shrink-0 items-center gap-1 rounded-xs px-2"
        style={{ backgroundColor: colors.backgroundColor, color: colors.textColor }}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <RenameField ref={renameRef} value={row.label} onValueChange={handleRename} className="label-xs flex-1" />
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

function PlaylistItemRow({ row, onDragOver, onDrop }: { row: PlaylistItemEntry } & RowDragProps) {
  return (
    <ContextMenu.Root>
      <PlaylistItemRowBody row={row} onDragOver={onDragOver} onDrop={onDrop} />
    </ContextMenu.Root>
  );
}

function PlaylistItemRowBody({ row, onDragOver, onDrop }: { row: PlaylistItemEntry } & RowDragProps) {
  const { currentPlaylistRows, currentPlaylistEntryId, renameItem, movePlaylistRow, removePlaylistRow } = useNavigation();
  const { selectPlaylistEntry } = useSlides();
  const { resolveItemRef } = useProjectContent();
  const confirm = useConfirm();
  const renameRef = useRef<RenameFieldHandle>(null);
  const itemRef = getPlaylistEntryItemRef(row);
  const item = resolveItemRef(itemRef);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger({ onDelete: () => { void handleRemove(); } });

  const isSelected = row.id === currentPlaylistEntryId;
  const index = currentPlaylistRows.findIndex((candidate) => candidate.id === row.id);
  const isFirst = index <= 0;
  const isLast = index === -1 || index === currentPlaylistRows.length - 1;

  function handleSelect() { selectPlaylistEntry(row.id); }

  function handleRename(name: string) {
    // renameItem rejects when the item no longer exists (#214), which a
    // rename field commit can race with a concurrent delete. mutatePatch has
    // already reported the failure, so absorb the rethrow here.
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
      <LumaCastPanel.MenuItem
        {...triggerHandlers}
        ref={triggerRef}
        active={isSelected}
        onClick={handleSelect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className='my-0.5 focus-visible:ring-2 focus-visible:ring-brand'
      >
        <ItemIcon entity={itemRef} className="shrink-0" />
        <RenameField ref={renameRef} value={item.title} onValueChange={handleRename} className="label-xs" />
      </LumaCastPanel.MenuItem>
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
    </>
  );
}
