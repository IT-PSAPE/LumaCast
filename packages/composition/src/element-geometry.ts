// Headless element geometry (issue #223 audit): axis-aligned bounds for
// (possibly rotated) elements, align/distribute transforms, and the
// group/ungroup coordinate rebasing every canvas command shares. Pure and
// side-effect free (aside from minting `createdAt`/`updatedAt` timestamps for
// a freshly created group, matching the convention in
// app/renderer/contexts/element/element-factory.ts) so it is unit-testable
// without a canvas, a store, or React.
//
// Rotation convention: every element rotates in place around its own `(x,
// y)` anchor (the box's local origin before rotation), matching how
// scene-traversal.ts hands `x, y, rotation` straight to the Konva node
// (Translate(x,y) → Rotate(rotation) with no center-of-box offset). Rotation
// degrees follow the same clockwise-on-screen convention Konva uses, so the
// standard rotation matrix applied directly to screen (x, y) coordinates
// reproduces it exactly.
import type { Id } from '@lumacast/kernel';
import type { GroupElementPayload, SlideElement, SlideElementBase } from './domain/slide-elements';

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Mirrors the (layer, zIndex) stacking convention in
// app/renderer/utils/slides.ts's `sortElements`, reimplemented locally: a
// package module cannot import app code, and the ordering is simple enough
// not to need a shared export.
const LAYER_RANK: Record<SlideElementBase['layer'], number> = {
  background: 0,
  media: 1,
  content: 2,
};

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function rotatePoint(x: number, y: number, cos: number, sin: number): [number, number] {
  return [x * cos - y * sin, x * sin + y * cos];
}

/** Axis-aligned bounds of a (possibly rotated) element, in absolute/parent coordinates. */
export function elementBounds(element: SlideElement): ElementBounds {
  const { x, y, width, height, rotation } = element;
  if (!rotation) return { x, y, width, height };
  const radians = degreesToRadians(rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners: Array<[number, number]> = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([localX, localY]) => {
    const [rx, ry] = rotatePoint(localX, localY, cos, sin);
    return [x + rx, y + ry];
  });
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function unionBounds(bounds: ElementBounds[]): ElementBounds | null {
  if (bounds.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of bounds) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';
export type AlignTarget = 'selection' | 'slide';

function referenceBoundsFor(elements: SlideElement[], target: AlignTarget, slide: { width: number; height: number }): ElementBounds {
  if (target === 'slide') return { x: 0, y: 0, width: slide.width, height: slide.height };
  return unionBounds(elements.map(elementBounds)) ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** Returns updated copies; single element + 'selection' is a no-op. */
export function alignElements(
  elements: SlideElement[],
  edge: AlignEdge,
  target: AlignTarget,
  slide: { width: number; height: number },
): SlideElement[] {
  if (elements.length === 0) return elements;
  if (elements.length < 2 && target === 'selection') return elements;
  const reference = referenceBoundsFor(elements, target, slide);
  return elements.map((element) => {
    const bounds = elementBounds(element);
    switch (edge) {
      case 'left':
        return { ...element, x: element.x + (reference.x - bounds.x) };
      case 'right':
        return { ...element, x: element.x + (reference.x + reference.width - (bounds.x + bounds.width)) };
      case 'centerX':
        return { ...element, x: element.x + (reference.x + reference.width / 2 - (bounds.x + bounds.width / 2)) };
      case 'top':
        return { ...element, y: element.y + (reference.y - bounds.y) };
      case 'bottom':
        return { ...element, y: element.y + (reference.y + reference.height - (bounds.y + bounds.height)) };
      case 'centerY':
        return { ...element, y: element.y + (reference.y + reference.height / 2 - (bounds.y + bounds.height / 2)) };
      default:
        return element;
    }
  });
}

export type DistributeAxis = 'horizontal' | 'vertical';

/** Equal gaps between ≥3 elements ordered by position; <3 is a no-op. */
export function distributeElements(elements: SlideElement[], axis: DistributeAxis): SlideElement[] {
  if (elements.length < 3) return elements;
  const start = (b: ElementBounds) => (axis === 'horizontal' ? b.x : b.y);
  const size = (b: ElementBounds) => (axis === 'horizontal' ? b.width : b.height);
  const entries = elements.map((element) => ({ element, bounds: elementBounds(element) }));
  const sorted = [...entries].sort((a, b) => start(a.bounds) - start(b.bounds));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = start(last.bounds) + size(last.bounds) - start(first.bounds);
  const totalSize = sorted.reduce((sum, entry) => sum + size(entry.bounds), 0);
  const gap = (span - totalSize) / (sorted.length - 1);
  const updatesById = new Map<Id, SlideElement>();
  let cursor = start(first.bounds) + size(first.bounds) + gap;
  for (let index = 1; index < sorted.length - 1; index += 1) {
    const entry = sorted[index];
    const delta = cursor - start(entry.bounds);
    updatesById.set(
      entry.element.id,
      axis === 'horizontal'
        ? { ...entry.element, x: entry.element.x + delta }
        : { ...entry.element, y: entry.element.y + delta },
    );
    cursor += size(entry.bounds) + gap;
  }
  return elements.map((element) => updatesById.get(element.id) ?? element);
}

export interface GroupElementsOptions {
  id: Id;
  name?: string;
  zIndex: number;
}

/**
 * A new group element at the union bounds of `elements`, with children
 * re-based to group-relative coordinates (each child keeps its own
 * rotation/size — the fresh group has rotation 0, so re-basing is a pure
 * translation) and ordered back-to-front by (layer, zIndex), matching
 * `sortElements`.
 */
export function groupElements(elements: SlideElement[], options: GroupElementsOptions): SlideElement {
  const bounds = unionBounds(elements.map(elementBounds)) ?? { x: 0, y: 0, width: 0, height: 0 };
  const ordered = [...elements].sort((a, b) => {
    const layerDiff = LAYER_RANK[a.layer] - LAYER_RANK[b.layer];
    if (layerDiff !== 0) return layerDiff;
    return a.zIndex - b.zIndex;
  });
  const children: SlideElement[] = ordered.map((element, index) => ({
    ...element,
    x: element.x - bounds.x,
    y: element.y - bounds.y,
    zIndex: index,
  }));
  const timestamp = new Date().toISOString();
  const payload: GroupElementPayload = {
    visible: true,
    locked: false,
    ...(options.name ? { name: options.name } : {}),
    children,
  };
  return {
    id: options.id,
    slideId: elements[0].slideId,
    type: 'group',
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    rotation: 0,
    opacity: 1,
    zIndex: options.zIndex,
    layer: 'content',
    payload,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

interface ChildFlipPayload {
  flipX?: boolean;
  flipY?: boolean;
}

/**
 * Children lifted to absolute coordinates: composes the group's position and
 * rotation (accumulated onto each child's own rotation), and — per
 * scene-traversal.ts's `scaleX`/`scaleY` flip convention — mirrors children
 * within the group's box and toggles their own flip when the group itself is
 * flipped. Non-group input passes through unchanged.
 */
export function ungroupElement(group: SlideElement): SlideElement[] {
  if (group.type !== 'group') return [group];
  const payload = group.payload as GroupElementPayload;
  const children = payload.children ?? [];
  if (children.length === 0) return [];
  const radians = degreesToRadians(group.rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const flipX = payload.flipX ?? false;
  const flipY = payload.flipY ?? false;
  return children.map((child, index) => {
    const localX = flipX ? group.width - child.x - child.width : child.x;
    const localY = flipY ? group.height - child.y - child.height : child.y;
    const [rx, ry] = rotatePoint(localX, localY, cos, sin);
    const childPayload = child.payload as ChildFlipPayload;
    const nextPayload = (flipX || flipY)
      ? { ...child.payload, flipX: flipX ? !(childPayload.flipX ?? false) : childPayload.flipX, flipY: flipY ? !(childPayload.flipY ?? false) : childPayload.flipY }
      : child.payload;
    return {
      ...child,
      x: group.x + rx,
      y: group.y + ry,
      rotation: child.rotation + group.rotation,
      opacity: child.opacity * group.opacity,
      zIndex: group.zIndex + index * 1e-4,
      layer: group.layer,
      slideId: group.slideId,
      payload: nextPayload,
    };
  });
}
