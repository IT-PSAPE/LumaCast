import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { DeckItem, PlaylistEntry, PlaylistTree } from '@core/types';
import { RenameField, type RenameFieldHandle } from '@renderer/components/form/rename-field';
import { Accordion } from '../../components/display/accordion';
import { ContextMenu, useContextMenuTrigger } from '../../components/overlays/context-menu';
import { useConfirm } from '../../components/overlays/confirm-dialog';
import { DeckItemIcon } from '../../components/display/entity-icon';
import { useNavigation } from '../../contexts/navigation-context';
import { useSlides } from '../../contexts/slide-context';
import { useLibraryBrowser } from './library-browser-context';
import { useLibraryPanelManagement } from './use-library-panel-management';
import { getGroupHeaderColors, GROUP_COLOR_OPTIONS } from './group-header-color';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { hasDeckItemDragData, readDeckItemDragData } from '../../utils/deck-item-drag';

interface PlaylistGroupProps {
  group: PlaylistTree['groups'][number];
  index: number;
  totalGroups: number;
}

export function PlaylistGroup(props: PlaylistGroupProps) {
  return (
    <ContextMenu.Root>
      <PlaylistGroupBody {...props} />
    </ContextMenu.Root>
  );
}

function PlaylistGroupBody({ group, index, totalGroups }: PlaylistGroupProps) {
  const { addDeckItemToGroupAt } = useNavigation();
  const { actions } = useLibraryBrowser();
  const { deleteGroup, movePlaylistGroup, setGroupColor } = useLibraryPanelManagement();
  const confirm = useConfirm();
  const isGroupEditing = actions.isEditing('group', group.group.id);
  const groupHeaderColors = getGroupHeaderColors(group.group.id, group.group.colorKey);
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: groupTriggerRef, ...groupTriggerHandlers } = useContextMenuTrigger();
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const isFirst = index === 0;
  const isLast = index === totalGroups - 1;

  useEffect(() => {
    if (isGroupEditing) renameRef.current?.startEditing();
  }, [isGroupEditing]);

  function handleGroupRename(name: string) {
    actions.renameGroup(group.group.id, name);
    actions.clearEditing();
  }

  async function handleGroupDelete() {
    const ok = await confirm({
      title: `Delete "${group.group.name}"?`,
      description: 'All entries in this group will be removed from the playlist.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteGroup(group.group.id);
  }

  // Container handlers (header / empty content) only seed an initial dropIndex
  // when nothing is set yet — they never overwrite a value that an entry-level
  // handler already chose. Without this, a user who positioned the indicator
  // on a specific entry would see it snap back to the group's default zone the
  // moment the cursor crossed a gap or the trigger row.
  function handleHeaderDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDeckItemDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropIndex((prev) => prev ?? 0);
  }

  function handleContentDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!hasDeckItemDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropIndex((prev) => prev ?? group.entries.length);
  }

  function handleEntryDragOver(entryIndex: number, event: React.DragEvent<HTMLElement>) {
    if (!hasDeckItemDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';

    const bounds = event.currentTarget.getBoundingClientRect();
    const isAfter = event.clientY > bounds.top + (bounds.height / 2);
    setDropIndex(isAfter ? entryIndex + 1 : entryIndex);
  }

  function handleDragLeave(event: React.DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDropIndex(null);
  }

  function handleDrop(event: React.DragEvent<HTMLElement>) {
    if (!hasDeckItemDragData(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();

    const itemId = readDeckItemDragData(event.dataTransfer);
    const nextDropIndex = dropIndex ?? group.entries.length;
    setDropIndex(null);
    if (!itemId) return;

    void addDeckItemToGroupAt(group.group.id, itemId, nextDropIndex);
  }

  return (
    <>
      <Accordion.Item value={group.group.id} className="group/group" onDragLeave={handleDragLeave}>
        <Accordion.Trigger
          className={`h-7 flex items-center gap-1 px-2 ${dropIndex !== null ? 'ring-1 ring-brand-600/60' : ''}`}
          style={{ backgroundColor: groupHeaderColors.backgroundColor, color: groupHeaderColors.textColor }}
          onDragOver={handleHeaderDragOver}
          onDrop={handleDrop}
        >
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]/group:rotate-90"
          />
          <div ref={groupTriggerRef} {...groupTriggerHandlers} className="flex-1 min-w-0">
            <RenameField ref={renameRef} value={group.group.name} onValueChange={handleGroupRename} className="label-xs" />
          </div>
        </Accordion.Trigger>
        {group.entries.length > 0 ? (
          <Accordion.Content className='p-1' onDragOver={handleContentDragOver} onDrop={handleDrop}>
            {renderGroupEntries({
              entries: group.entries,
              dropIndex,
              onEntryDragOver: handleEntryDragOver,
              onEntryDrop: handleDrop,
            })}
          </Accordion.Content>
        ) : null}
      </Accordion.Item>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item disabled={isFirst} onSelect={() => { void movePlaylistGroup(group.group.id, index, 'up'); }}>Move up</ContextMenu.Item>
          <ContextMenu.Item disabled={isLast} onSelect={() => { void movePlaylistGroup(group.group.id, index, 'down'); }}>Move down</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Submenu label="Color">
            <ContextMenu.Item onSelect={() => { void setGroupColor(group.group.id, null); }}>
              <span className="inline-block size-3 shrink-0 rounded-sm border border-secondary bg-transparent" aria-hidden />
              <span>Default</span>
            </ContextMenu.Item>
            <ContextMenu.Separator />
            {GROUP_COLOR_OPTIONS.map((option) => {
              const isActive = group.group.colorKey === option.key;
              return (
                <ContextMenu.Item key={option.key} onSelect={() => { void setGroupColor(group.group.id, option.key); }}>
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
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleGroupDelete(); }}>Delete group</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

interface GroupEntryRowProps {
  entry: PlaylistEntry;
  item: DeckItem;
  index: number;
  totalEntries: number;
  onDeckItemDragOver: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDeckItemDrop: (event: React.DragEvent<HTMLButtonElement>) => void;
}

function GroupEntryRow(props: GroupEntryRowProps) {
  return (
    <ContextMenu.Root>
      <GroupEntryRowBody {...props} />
    </ContextMenu.Root>
  );
}

function GroupEntryRowBody({
  item,
  entry,
  index,
  totalEntries,
  onDeckItemDragOver,
  onDeckItemDrop,
}: GroupEntryRowProps) {
  const { currentPlaylistEntryId, renameDeckItem, movePlaylistEntryDirection, removePlaylistEntry } = useNavigation();
  const { selectPlaylistEntry } = useSlides();
  const confirm = useConfirm();
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: triggerRef, ...triggerHandlers } = useContextMenuTrigger();

  const isSelected = entry.id === currentPlaylistEntryId;
  const isFirst = index === 0;
  const isLast = index === totalEntries - 1;

  function handleSelect() { selectPlaylistEntry(entry.id); }

  function handleRename(name: string) {
    void renameDeckItem(item.id, name);
  }

  async function handleRemoveFromGroup() {
    const ok = await confirm({
      title: `Remove "${item.title}" from group?`,
      description: 'The item stays in your library — only the playlist entry is removed.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) await removePlaylistEntry(entry.id);
  }

  return (
    <>
      <LumaCastPanel.MenuItem
        {...triggerHandlers}
        ref={triggerRef}
        active={isSelected}
        onClick={handleSelect}
        onDragOver={onDeckItemDragOver}
        onDrop={onDeckItemDrop}
        className='my-0.5'
      >
        <DeckItemIcon entity={item} className="shrink-0" />
        <RenameField ref={renameRef} value={item.title} onValueChange={handleRename} className="label-xs" />
      </LumaCastPanel.MenuItem>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item disabled={isFirst} onSelect={() => { void movePlaylistEntryDirection(entry.id, 'up'); }}>Move up</ContextMenu.Item>
          <ContextMenu.Item disabled={isLast} onSelect={() => { void movePlaylistEntryDirection(entry.id, 'down'); }}>Move down</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleRemoveFromGroup(); }}>Remove from group</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

function renderGroupEntries({
  entries,
  dropIndex,
  onEntryDragOver,
  onEntryDrop,
}: {
  entries: PlaylistTree['groups'][number]['entries'];
  dropIndex: number | null;
  onEntryDragOver: (index: number, event: React.DragEvent<HTMLButtonElement>) => void;
  onEntryDrop: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const nodes: React.ReactNode[] = [];

  entries.forEach((entry, index) => {
    if (dropIndex === index) {
      nodes.push(<DropIndicator key={`drop-${index}`} />);
    }

    nodes.push(
      <GroupEntryRow
        key={entry.entry.id}
        entry={entry.entry}
        item={entry.item}
        index={index}
        totalEntries={entries.length}
        onDeckItemDragOver={(event) => onEntryDragOver(index, event)}
        onDeckItemDrop={onEntryDrop}
      />,
    );
  });

  if (dropIndex === entries.length) {
    nodes.push(<DropIndicator key="drop-end" />);
  }

  return nodes;
}

function DropIndicator() {
  return (
    <div className="0px w-full overflow-visible relative !m-0">
      <div className="absolute inset-0 h-[2px] w-full bg-brand_solid -translate-y-1/2" />
    </div>
  );
}
