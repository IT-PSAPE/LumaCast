import type { ItemRef, Slide } from '@lumacast/composition';
import { BinShell } from '@renderer/components/layout/bin-shell';
import { useBinControls } from '@renderer/components/controls/bin-controls';
import { GroupedVirtualizedCollection, type GroupedVirtualizedCollectionSection } from '@renderer/components/layout/virtualized-grouped-collection';
import { itemRefKey } from '../../contexts/use-project-content';
import { useCreateItem } from './create-item';
import { CreateItemDropZone } from './create-item-drop-zone';
import { ItemBinRow } from './item-bin-row';
import { ItemBinTile } from './item-bin-tile';
import type { ItemLike } from './item-bin-types';
import { useDeckBin } from './use-deck-bin';

export { useDuplicateItem } from './use-duplicate-item';

export function DeckBinPanel() {
  const { open: openCreateItem } = useCreateItem();
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
  const virtualSections = sections.map<GroupedVirtualizedCollectionSection<(typeof sections)[number]['items'][number]>>((section) => ({
    key: section.type,
    label: section.label,
    items: section.items,
    emptyState: <CreateItemDropZone itemType={section.type} onActivate={() => openCreateItem(section.type)} />,
  }));

  return (
    <BinShell>
      <BinShell.Content>
        <GroupedVirtualizedCollection
          sections={virtualSections}
          mode={viewMode}
          gridItemSize={gridSize}
          listItemEstimate={44}
          gridRowEstimate={180}
          emptyEstimate={208}
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
            onOpen: browseItem,
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
            onOpen: browseItem,
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
  onOpen: (itemRef: ItemRef) => void;
  onRename: (itemRef: ItemRef, title: string) => void;
  onMove: (itemRef: ItemRef, direction: 'up' | 'down') => void;
}) {
  const itemRef: ItemRef = { type: section.key as ItemRef['type'], id: item.id };
  const shared = {
    item,
    itemRef,
    slides: slidesByItem.get(itemRefKey(itemRef)) ?? [],
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
