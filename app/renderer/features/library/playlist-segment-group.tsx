import { useEffect, useRef, useState } from 'react';
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
import { getSegmentHeaderColors } from './segment-header-color';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { hasDeckItemDragData, readDeckItemDragData } from '../../utils/deck-item-drag';

interface PlaylistSegmentGroupProps {
  segment: PlaylistTree['segments'][number];
  index: number;
  totalSegments: number;
}

export function PlaylistSegmentGroup(props: PlaylistSegmentGroupProps) {
  return (
    <ContextMenu.Root>
      <PlaylistSegmentGroupBody {...props} />
    </ContextMenu.Root>
  );
}

function PlaylistSegmentGroupBody({ segment, index, totalSegments }: PlaylistSegmentGroupProps) {
  const { addDeckItemToSegmentAt } = useNavigation();
  const { actions } = useLibraryBrowser();
  const { deleteSegment, movePlaylistSegment } = useLibraryPanelManagement();
  const confirm = useConfirm();
  const isSegmentEditing = actions.isEditing('segment', segment.segment.id);
  const segmentHeaderColors = getSegmentHeaderColors(segment.segment.id, segment.segment.colorKey);
  const renameRef = useRef<RenameFieldHandle>(null);
  const { ref: segmentTriggerRef, ...segmentTriggerHandlers } = useContextMenuTrigger();
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const isFirst = index === 0;
  const isLast = index === totalSegments - 1;

  useEffect(() => {
    if (isSegmentEditing) renameRef.current?.startEditing();
  }, [isSegmentEditing]);

  function handleSegmentRename(name: string) {
    actions.renameSegment(segment.segment.id, name);
    actions.clearEditing();
  }

  async function handleSegmentDelete() {
    const ok = await confirm({
      title: `Delete "${segment.segment.name}"?`,
      description: 'All entries in this segment will be removed from the playlist.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteSegment(segment.segment.id);
  }

  function acceptDeckItemDrop(event: React.DragEvent<HTMLElement>, nextDropIndex: number) {
    if (!hasDeckItemDragData(event.dataTransfer)) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropIndex(nextDropIndex);
    return true;
  }

  function handleHeaderDragOver(event: React.DragEvent<HTMLDivElement>) {
    acceptDeckItemDrop(event, segment.entries.length);
  }

  function handleContentDragOver(event: React.DragEvent<HTMLDivElement>) {
    acceptDeckItemDrop(event, segment.entries.length);
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
    const nextDropIndex = dropIndex ?? segment.entries.length;
    setDropIndex(null);
    if (!itemId) return;

    void addDeckItemToSegmentAt(segment.segment.id, itemId, nextDropIndex);
  }

  return (
    <>
      <Accordion.Item value={segment.segment.id} className="group/segment" onDragLeave={handleDragLeave}>
        <Accordion.Trigger
          className={`h-7 flex items-center justify-between px-2 ${dropIndex !== null ? 'ring-1 ring-brand_solid/60' : ''}`}
          style={{ backgroundColor: segmentHeaderColors.backgroundColor, color: segmentHeaderColors.textColor }}
          onDragOver={handleHeaderDragOver}
          onDrop={handleDrop}
        >
          <div ref={segmentTriggerRef} {...segmentTriggerHandlers} className="flex-1 min-w-0">
            <RenameField ref={renameRef} value={segment.segment.name} onValueChange={handleSegmentRename} className="label-xs" />
          </div>
        </Accordion.Trigger>
        <Accordion.Content className='p-1' onDragOver={handleContentDragOver} onDrop={handleDrop}>
          {renderSegmentEntries({
            entries: segment.entries,
            dropIndex,
            onEntryDragOver: handleEntryDragOver,
            onEntryDrop: handleDrop,
          })}
        </Accordion.Content>
      </Accordion.Item>
      <ContextMenu.Portal>
        <ContextMenu.Menu>
          <ContextMenu.Item disabled={isFirst} onSelect={() => { void movePlaylistSegment(segment.segment.id, index, 'up'); }}>Move up</ContextMenu.Item>
          <ContextMenu.Item disabled={isLast} onSelect={() => { void movePlaylistSegment(segment.segment.id, index, 'down'); }}>Move down</ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item onSelect={() => { renameRef.current?.startEditing(); }}>Rename</ContextMenu.Item>
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleSegmentDelete(); }}>Delete segment</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

interface SegmentEntryRowProps {
  entry: PlaylistEntry;
  item: DeckItem;
  index: number;
  totalEntries: number;
  onDeckItemDragOver: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDeckItemDrop: (event: React.DragEvent<HTMLButtonElement>) => void;
}

function SegmentEntryRow(props: SegmentEntryRowProps) {
  return (
    <ContextMenu.Root>
      <SegmentEntryRowBody {...props} />
    </ContextMenu.Root>
  );
}

function SegmentEntryRowBody({
  item,
  entry,
  index,
  totalEntries,
  onDeckItemDragOver,
  onDeckItemDrop,
}: SegmentEntryRowProps) {
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

  async function handleRemoveFromSegment() {
    const ok = await confirm({
      title: `Remove "${item.title}" from segment?`,
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
          <ContextMenu.Item variant="destructive" onSelect={() => { void handleRemoveFromSegment(); }}>Remove from segment</ContextMenu.Item>
        </ContextMenu.Menu>
      </ContextMenu.Portal>
    </>
  );
}

function renderSegmentEntries({
  entries,
  dropIndex,
  onEntryDragOver,
  onEntryDrop,
}: {
  entries: PlaylistTree['segments'][number]['entries'];
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
      <SegmentEntryRow
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
