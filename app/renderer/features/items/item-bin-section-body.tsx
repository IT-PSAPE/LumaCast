import type { ItemRef, Slide } from '@lumacast/composition';
import { Label } from '../../components/display/text';
import { BinPanelLayout } from '@renderer/components/layout/collection-layout';
import { itemRefKey } from '../../contexts/use-project-content';
import type { ResourceDrawerViewMode } from '../../types/ui';
import { CreateItemDropZone } from './create-item-drop-zone';
import type { ItemLike } from './item-bin-types';
import { ItemBinRow } from './item-bin-row';
import { ItemBinTile } from './item-bin-tile';
import type { ItemBinSection } from './use-deck-bin';

interface ItemBinSectionBodyProps<T extends ItemLike> {
  section: ItemBinSection<T>;
  gridSize: number;
  viewMode: ResourceDrawerViewMode;
  isDetachedDeckBrowser: boolean;
  currentDrawerItemRef: ItemRef | null;
  editingItemRef: ItemRef | null;
  slidesByItem: ReadonlyMap<string, Slide[]>;
  onOpen: (itemRef: ItemRef) => void;
  onRename: (itemRef: ItemRef, title: string) => void;
  onMove: (itemRef: ItemRef, direction: 'up' | 'down') => void;
  onCreate: () => void;
}

export function ItemBinSectionBody<T extends ItemLike>({
  section,
  gridSize,
  viewMode,
  isDetachedDeckBrowser,
  currentDrawerItemRef,
  editingItemRef,
  slidesByItem,
  onOpen,
  onRename,
  onMove,
  onCreate,
}: ItemBinSectionBodyProps<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label.xs className="px-1 text-tertiary">{section.label}</Label.xs>
      {section.items.length === 0 ? (
        <CreateItemDropZone itemType={section.type} onActivate={onCreate} />
      ) : (
        <BinPanelLayout gridItemSize={gridSize} mode={viewMode}>
          {section.items.map((item, index) => {
            const itemRef: ItemRef = { type: section.type, id: item.id };
            const shared = {
              item,
              itemRef,
              slides: slidesByItem.get(itemRefKey(itemRef)) ?? [],
              isSelected: isDetachedDeckBrowser && currentDrawerItemRef !== null
                && currentDrawerItemRef.type === section.type && currentDrawerItemRef.id === item.id,
              isEditing: editingItemRef !== null && editingItemRef.type === section.type && editingItemRef.id === item.id,
              isFirst: index === 0,
              isLast: index === section.items.length - 1,
              onOpen,
              onRename,
              onMove,
            };
            return viewMode === 'list'
              ? <ItemBinRow key={item.id} {...shared} />
              : <ItemBinTile key={item.id} {...shared} />;
          })}
        </BinPanelLayout>
      )}
    </div>
  );
}
