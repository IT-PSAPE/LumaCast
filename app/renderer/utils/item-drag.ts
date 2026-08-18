import type { Id } from '@lumacast/kernel';
import type { ItemRef, ItemType } from '@lumacast/composition';

// #219 item-model refactor decision D9: the drag MIME carries a typed
// `itemType` alongside the id — there is no merged deck-item id space to
// drop-target-validate against any more. Drop targets that only understand
// the pre-refactor MIME string see no match for this one and simply ignore
// the drop, which is the graceful-ignore behavior the design calls for.
const ITEM_DRAG_TYPE = 'application/x-lumacast-item';

interface ItemDragPayload {
  itemType: ItemType;
  itemId: Id;
}

function isItemType(value: unknown): value is ItemType {
  return value === 'presentation' || value === 'lyric' || value === 'talk';
}

export function writeItemDragData(dataTransfer: DataTransfer, itemRef: ItemRef): void {
  const payload: ItemDragPayload = { itemType: itemRef.type, itemId: itemRef.id };
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify(payload));
  dataTransfer.setData('text/plain', itemRef.id);
}

export function hasItemDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(ITEM_DRAG_TYPE);
}

export function readItemDragData(dataTransfer: DataTransfer): ItemRef | null {
  const raw = dataTransfer.getData(ITEM_DRAG_TYPE);
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as Partial<ItemDragPayload>;
    if (typeof payload.itemId === 'string' && payload.itemId.length > 0 && isItemType(payload.itemType)) {
      return { type: payload.itemType, id: payload.itemId };
    }
    return null;
  } catch {
    return null;
  }
}
