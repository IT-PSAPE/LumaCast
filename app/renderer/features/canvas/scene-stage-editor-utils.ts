import type Konva from 'konva';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import type { SnapBox } from './snap-guides';

export interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function normalizeRect(rect: SelectionBox): SelectionBox {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x;
  const y = rect.height < 0 ? rect.y + rect.height : rect.y;
  return { x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) };
}

export function mapSnapBoxes(elements: SlideElement[], excludedIds: Set<Id>): SnapBox[] {
  return elements
    .filter((element) => !excludedIds.has(element.id))
    .map((element) => ({ id: element.id, x: element.x, y: element.y, width: element.width, height: element.height }));
}

export function collectMarqueeHits(nodeRefs: Map<Id, Konva.Group>, rect: SelectionBox): Id[] {
  const hitIds: Id[] = [];
  for (const [id, node] of nodeRefs.entries()) {
    const box = node.getClientRect();
    const overlap =
      rect.x < box.x + box.width &&
      rect.x + rect.width > box.x &&
      rect.y < box.y + box.height &&
      rect.y + rect.height > box.y;
    if (overlap) hitIds.push(id);
  }
  return hitIds;
}
