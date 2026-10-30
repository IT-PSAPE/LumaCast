import type { ItemRef, Slide } from '@lumacast/composition';
import { useConfirm } from '@lumacast/ui';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { GroupedVirtualizedCollection, type GroupedVirtualizedCollectionSection } from '@renderer/components/layout/virtualized-grouped-collection';
import { useNavigation } from '../../contexts/navigation-context';
import { itemRefKey } from '../../contexts/use-project-content';
import { useMultiSelection, useMultiSelectionKeyHandler } from '@lumacast/selection';
import { useCreateItem } from './create-item';
import { CreateItemDropZone } from './create-item-drop-zone';
import { ItemBinRow } from './item-bin-row';
import { ItemBinTile } from './item-bin-tile';
import type { ItemLike } from './item-bin-types';
import { useDeckBin } from './use-deck-bin';

export { useDuplicateItem } from './use-duplicate-item';

export function DeckBinPanel() {
  const { open: openCreateItem } = useCreateItem();
  const { deleteItem, moveItem } = useNavigation();
  const confirm = useConfirm();
  const {
    sections,
    editingItemRef,
    browseItem,
    isDetachedDeckBrowser,
    currentDrawerItemRef,
    handleRename,
    handleMove,
    slidesByItem,
  } = useDeckBin();
  const { state: { viewMode, grid } } = useBinControls();
  const gridSize = grid?.value ?? 6;
  const orderedItemRefs = sections.flatMap((section) => section.items.map((item) => ({ type: section.type, id: item.id } as ItemRef)));
  const orderedItemIds = orderedItemRefs.map(itemRefKey);
  const itemRefByKey = new Map(orderedItemRefs.map((itemRef) => [itemRefKey(itemRef), itemRef]));
  const selection = useMultiSelection(orderedItemIds, 'deck-bin');
  const handleSelectionKeys = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });

  function getActionItemRefs(clickedItemRef: ItemRef): ItemRef[] {
    return selection.actionIds(itemRefKey(clickedItemRef)).flatMap((id) => {
      const itemRef = itemRefByKey.get(id);
      return itemRef ? [itemRef] : [];
    });
  }

  function retainSelection(itemRefs: readonly ItemRef[]) {
    const visible = [...itemRefs].sort((left, right) => orderedItemIds.indexOf(itemRefKey(left)) - orderedItemIds.indexOf(itemRefKey(right)));
    selection.clearSelection();
    visible.forEach((itemRef, index) => selection.select(itemRefKey(itemRef), index === 0 ? {} : { ctrlKey: true }));
  }

  async function handleDeleteItems(itemRefs: readonly ItemRef[]) {
    const ok = await confirm({
      title: `Delete ${itemRefs.length} items?`,
      description: 'These items and all their slides will be permanently removed. This action cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;

    for (let index = 0; index < itemRefs.length; index += 1) {
      try {
        await deleteItem(itemRefs[index]);
      } catch {
        retainSelection(itemRefs.slice(index));
        return;
      }
    }
    selection.clearSelection();
  }

  async function handleMoveItems(itemRefs: readonly ItemRef[], direction: 'up' | 'down') {
    const sectionOrder = new Map(sections.map((section, index) => [section.type, index]));
    const visibleOrder = new Map(orderedItemRefs.map((itemRef, index) => [itemRefKey(itemRef), index]));
    const manualOrder = new Map(sections.flatMap((section) => section.items.map((item, index) => [
      itemRefKey({ type: section.type, id: item.id }),
      typeof item.order === 'number' ? item.order : index,
    ] as const)));
    const ordered = [...itemRefs].sort((left, right) => {
      const sectionDelta = (sectionOrder.get(left.type) ?? 0) - (sectionOrder.get(right.type) ?? 0);
      if (sectionDelta !== 0) return sectionDelta;
      const leftOrder = manualOrder.get(itemRefKey(left)) ?? visibleOrder.get(itemRefKey(left)) ?? 0;
      const rightOrder = manualOrder.get(itemRefKey(right)) ?? visibleOrder.get(itemRefKey(right)) ?? 0;
      const orderDelta = leftOrder - rightOrder;
      return direction === 'up' ? orderDelta : -orderDelta;
    });
    for (let index = 0; index < ordered.length; index += 1) {
      try {
        await moveItem(ordered[index], direction);
      } catch {
        retainSelection(ordered.slice(index));
        return;
      }
    }
  }

  function handleOpen(itemRef: ItemRef, event?: React.MouseEvent<HTMLElement>) {
    selection.select(itemRefKey(itemRef), event);
    if (event?.shiftKey || event?.metaKey || event?.ctrlKey) return;
    browseItem(itemRef);
  }
  const virtualSections = sections.map<GroupedVirtualizedCollectionSection<(typeof sections)[number]['items'][number]>>((section) => ({
    key: section.type,
    label: section.label,
    items: section.items,
  }));

  return (
    <BinShell>
      <BinShell.Content data-shortcuts-scope="ignore" onKeyDown={handleSelectionKeys}>
        <GroupedVirtualizedCollection
          sections={virtualSections}
          mode={viewMode}
          gridItemSize={gridSize}
          listItemEstimate={44}
          gridRowEstimate={180}
          emptyEstimate={208}
          renderEmptyState={(section) => (
            <CreateItemDropZone
              itemType={section.key as ItemRef['type']}
              onActivate={() => openCreateItem(section.key as ItemRef['type'])}
            />
          )}
          getItemKey={(item) => item.id}
          renderListItem={(item, index, section) => renderItemBinNode({
            item,
            index,
            section,
            viewMode: 'list',
            isDetachedDeckBrowser,
            currentDrawerItemRef,
            editingItemRef,
            slidesByItem,
            selectedItemIds: selection.selectedIds,
            getActionItemRefs,
            onDeleteItems: handleDeleteItems,
            onMoveItems: handleMoveItems,
            onOpen: handleOpen,
            onRename: handleRename,
            onMove: handleMove,
          })}
          renderGridItem={(item, index, section) => renderItemBinNode({
            item,
            index,
            section,
            viewMode: 'grid',
            isDetachedDeckBrowser,
            currentDrawerItemRef,
            editingItemRef,
            slidesByItem,
            selectedItemIds: selection.selectedIds,
            getActionItemRefs,
            onDeleteItems: handleDeleteItems,
            onMoveItems: handleMoveItems,
            onOpen: handleOpen,
            onRename: handleRename,
            onMove: handleMove,
          })}
        />
      </BinShell.Content>
    </BinShell>
  );
}

function renderItemBinNode<T extends ItemLike>({
  item,
  index,
  section,
  viewMode,
  isDetachedDeckBrowser,
  currentDrawerItemRef,
  editingItemRef,
  slidesByItem,
  selectedItemIds,
  getActionItemRefs,
  onDeleteItems,
  onMoveItems,
  onOpen,
  onRename,
  onMove,
}: {
  item: T;
  index: number;
  section: GroupedVirtualizedCollectionSection<T>;
  viewMode: 'grid' | 'list';
  isDetachedDeckBrowser: boolean;
  currentDrawerItemRef: ItemRef | null;
  editingItemRef: ItemRef | null;
  slidesByItem: ReadonlyMap<string, Slide[]>;
  selectedItemIds: ReadonlySet<string>;
  getActionItemRefs: (itemRef: ItemRef) => ItemRef[];
  onDeleteItems: (itemRefs: readonly ItemRef[]) => void | Promise<void>;
  onMoveItems: (itemRefs: readonly ItemRef[], direction: 'up' | 'down') => void | Promise<void>;
  onOpen: (itemRef: ItemRef, event?: React.MouseEvent<HTMLElement>) => void;
  onRename: (itemRef: ItemRef, title: string) => void;
  onMove: (itemRef: ItemRef, direction: 'up' | 'down') => void;
}) {
  const itemRef: ItemRef = { type: section.key as ItemRef['type'], id: item.id };
  const shared = {
    item,
    itemRef,
    slides: slidesByItem.get(itemRefKey(itemRef)) ?? [],
    isMultiSelected: selectedItemIds.has(itemRefKey(itemRef)),
    actionItemRefs: getActionItemRefs(itemRef),
    onDeleteItems,
    onMoveItems,
    isSelected: isDetachedDeckBrowser && currentDrawerItemRef !== null
      && currentDrawerItemRef.type === itemRef.type && currentDrawerItemRef.id === item.id,
    isEditing: editingItemRef !== null && editingItemRef.type === itemRef.type && editingItemRef.id === item.id,
    isFirst: index === 0,
    isLast: index === section.items.length - 1,
    onOpen,
    onRename,
    onMove,
  };

  return viewMode === 'list'
    ? <ItemBinRow key={item.id} {...shared} />
    : <ItemBinTile key={item.id} {...shared} />;
}
