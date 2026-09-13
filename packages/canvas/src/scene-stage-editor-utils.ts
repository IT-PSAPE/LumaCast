import type Konva from 'konva';
import type { Id } from '@lumacast/kernel';
import type { GroupElementPayload, SlideElement, TextElementPayload } from '@lumacast/composition';
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

/**
 * Recursively re-bases a group's children onto a new box size: every
 * descendant's `x`/`y`/`width`/`height` (defined relative to its own
 * immediate parent's local box) scale by the same `scaleX`/`scaleY` the
 * group itself just resized by. Nested groups recurse so a group-in-group
 * scales consistently at every level.
 *
 * A rotated child's own `rotation` is left unchanged — a non-uniform
 * (`scaleX !== scaleY`) resize of a rotated box cannot stay an axis-aligned
 * rectangle without shearing, so this keeps the widely-used practical
 * approximation (position/size scale, rotation angle holds) rather than
 * attempting an exact shear decomposition.
 *
 * Text children scale `fontSize` (and `autoFitMaxFontSize`) by the geometric
 * mean of `scaleX`/`scaleY` unless `autoFit` is on, in which case the
 * existing auto-fit layout already recomputes the best-fit font size from
 * the (now-scaled) box on its own next render — untouched here.
 */
export function scaleGroupChildren(children: SlideElement[], scaleX: number, scaleY: number): SlideElement[] {
  if (scaleX === 1 && scaleY === 1) return children;
  const fontScale = Math.sqrt(Math.abs(scaleX * scaleY));
  return children.map((child) => {
    const scaled: SlideElement = {
      ...child,
      x: child.x * scaleX,
      y: child.y * scaleY,
      width: Math.max(1, child.width * Math.abs(scaleX)),
      height: Math.max(1, child.height * Math.abs(scaleY)),
    };
    if (child.type === 'text') {
      const payload = child.payload as TextElementPayload;
      if (!payload.autoFit && fontScale !== 1) {
        scaled.payload = {
          ...payload,
          fontSize: Math.max(1, payload.fontSize * fontScale),
          ...(payload.autoFitMaxFontSize ? { autoFitMaxFontSize: Math.max(1, payload.autoFitMaxFontSize * fontScale) } : {}),
        };
      }
    } else if (child.type === 'group') {
      const payload = child.payload as GroupElementPayload;
      scaled.payload = { ...payload, children: scaleGroupChildren(payload.children ?? [], scaleX, scaleY) };
    }
    return scaled;
  });
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
