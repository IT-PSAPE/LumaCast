import type { Id } from '@core/types';

const DECK_ITEM_DRAG_TYPE = 'application/x-lumacast-deck-item';

interface DeckItemDragPayload {
  itemId: Id;
}

export function writeDeckItemDragData(dataTransfer: DataTransfer, itemId: Id): void {
  const payload: DeckItemDragPayload = { itemId };
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(DECK_ITEM_DRAG_TYPE, JSON.stringify(payload));
  dataTransfer.setData('text/plain', itemId);
}

export function hasDeckItemDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(DECK_ITEM_DRAG_TYPE);
}

export function readDeckItemDragData(dataTransfer: DataTransfer): Id | null {
  const raw = dataTransfer.getData(DECK_ITEM_DRAG_TYPE);
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as Partial<DeckItemDragPayload>;
    return typeof payload.itemId === 'string' && payload.itemId.length > 0 ? payload.itemId : null;
  } catch {
    return null;
  }
}
