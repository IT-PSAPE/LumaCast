import type { SourceTransform } from '../shared/desktop-api';
import { normalizeSourceRotation } from '../shared/source-geometry';

export interface SourceSize {
  width: number;
  height: number;
}

export function canTransformSource(locked?: boolean): boolean {
  return locked !== true;
}

export function fitSourceToCanvas(sourceSize: SourceSize, canvasSize: SourceSize): SourceTransform {
  const sourceWidth = Number.isFinite(sourceSize.width) && sourceSize.width > 0 ? sourceSize.width : canvasSize.width;
  const sourceHeight = Number.isFinite(sourceSize.height) && sourceSize.height > 0 ? sourceSize.height : canvasSize.height;
  const scale = Math.min(canvasSize.width / sourceWidth, canvasSize.height / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.round((canvasSize.width - width) / 2),
    y: Math.round((canvasSize.height - height) / 2),
    width,
    height,
  };
}

export interface SourcePoint {
  x: number;
  y: number;
}

export interface SourceBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SourceSnapTargets {
  x: number[];
  y: number[];
}

export interface SourceSnapGuide {
  axis: 'x' | 'y';
  position: number;
}

export interface SourceSnapTolerance {
  x: number;
  y: number;
}

/** Rotates a scene-space point around the center of a source. Positive angles are clockwise on screen. */
export function rotatePointAroundSource(point: SourcePoint, transform: SourceTransform, degrees = transform.rotation ?? 0): SourcePoint {
  const radians = normalizeSourceRotation(degrees) * Math.PI / 180;
  if (radians === 0) return point;
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  const deltaX = point.x - centerX;
  const deltaY = point.y - centerY;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: centerX + deltaX * cosine - deltaY * sine, y: centerY + deltaX * sine + deltaY * cosine };
}

/** Tests a scene-space point against the source's rotated rectangle. */
export function sourceContainsPoint(transform: SourceTransform, x: number, y: number): boolean {
  const local = rotatePointAroundSource({ x, y }, transform, -(transform.rotation ?? 0));
  return local.x >= transform.x && local.x <= transform.x + transform.width
    && local.y >= transform.y && local.y <= transform.y + transform.height;
}

/** Returns the axis-aligned scene-space bounds of a source, including its rotation. */
export function sourceBounds(transform: SourceTransform): SourceBounds {
  const corners = [
    { x: transform.x, y: transform.y },
    { x: transform.x + transform.width, y: transform.y },
    { x: transform.x + transform.width, y: transform.y + transform.height },
    { x: transform.x, y: transform.y + transform.height },
  ].map((point) => rotatePointAroundSource(point, transform));
  return {
    left: Math.min(...corners.map((point) => point.x)),
    top: Math.min(...corners.map((point) => point.y)),
    right: Math.max(...corners.map((point) => point.x)),
    bottom: Math.max(...corners.map((point) => point.y)),
  };
}

/** Combines transformed source bounds into one selection bound. */
export function sourceBoundsForSelection(transforms: readonly SourceTransform[]): SourceBounds | null {
  if (transforms.length === 0) return null;
  const bounds = transforms.map(sourceBounds);
  return {
    left: Math.min(...bounds.map((item) => item.left)),
    top: Math.min(...bounds.map((item) => item.top)),
    right: Math.max(...bounds.map((item) => item.right)),
    bottom: Math.max(...bounds.map((item) => item.bottom)),
  };
}

function snapAxis(values: readonly number[], delta: number, targets: readonly number[], tolerance: number): { delta: number; guide: number | null } {
  let bestAdjustment = 0;
  let bestGuide: number | null = null;
  let bestDistance = tolerance + Number.EPSILON;
  for (const value of values) {
    const movedValue = value + delta;
    for (const target of targets) {
      const adjustment = target - movedValue;
      const distance = Math.abs(adjustment);
      if (distance <= tolerance && distance < bestDistance) {
        bestAdjustment = adjustment;
        bestGuide = target;
        bestDistance = distance;
      }
    }
  }
  return { delta: delta + bestAdjustment, guide: bestGuide };
}

/** Snaps a moved selection's outer bounds to target coordinates on each axis. */
export function snapSourceTranslation(
  bounds: SourceBounds,
  deltaX: number,
  deltaY: number,
  targets: SourceSnapTargets,
  tolerance: SourceSnapTolerance,
): { deltaX: number; deltaY: number; guides: SourceSnapGuide[] } {
  const horizontal = snapAxis([bounds.left, (bounds.left + bounds.right) / 2, bounds.right], deltaX, targets.x, tolerance.x);
  const vertical = snapAxis([bounds.top, (bounds.top + bounds.bottom) / 2, bounds.bottom], deltaY, targets.y, tolerance.y);
  return {
    deltaX: horizontal.delta,
    deltaY: vertical.delta,
    guides: [
      ...(horizontal.guide === null ? [] : [{ axis: 'x' as const, position: horizontal.guide }]),
      ...(vertical.guide === null ? [] : [{ axis: 'y' as const, position: vertical.guide }]),
    ],
  };
}

export function sourceResizeHandlePosition(transform: SourceTransform, handle: string): SourcePoint {
  const local = {
    x: handle.includes('w') ? transform.x : handle.includes('e') ? transform.x + transform.width : transform.x + transform.width / 2,
    y: handle.includes('n') ? transform.y : handle.includes('s') ? transform.y + transform.height : transform.y + transform.height / 2,
  };
  return rotatePointAroundSource(local, transform);
}

function resizeHandleDirection(transform: SourceTransform, handle: string, lockAspectRatio: boolean): SourcePoint | null {
  const radians = normalizeSourceRotation(transform.rotation) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const affectsWidth = handle.includes('e') || handle.includes('w');
  const affectsHeight = handle.includes('n') || handle.includes('s');
  if (affectsWidth && affectsHeight && !lockAspectRatio) return null;
  if (affectsWidth && affectsHeight) {
    const widthSign = handle.includes('e') ? 1 : -1;
    const heightSign = handle.includes('s') ? 1 : -1;
    return {
      x: cosine * widthSign * transform.width - sine * heightSign * transform.height,
      y: sine * widthSign * transform.width + cosine * heightSign * transform.height,
    };
  }
  return affectsWidth ? { x: cosine, y: sine } : { x: -sine, y: cosine };
}

function nearestAxisTarget(value: number, targets: readonly number[], tolerance: number): number | null {
  let best: number | null = null;
  let bestDistance = tolerance + Number.EPSILON;
  for (const target of targets) {
    const distance = Math.abs(target - value);
    if (distance <= tolerance && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

/** Adjusts a resize gesture's pointer delta so its moving handle lands on snap targets. */
export function snapResizePointerDelta(
  transform: SourceTransform,
  handle: string,
  deltaX: number,
  deltaY: number,
  targets: SourceSnapTargets,
  tolerance: SourceSnapTolerance,
  lockAspectRatio = false,
  minimumSize = 16,
): { deltaX: number; deltaY: number; guides: SourceSnapGuide[] } {
  const resized = resizeSourceFromPointer(transform, handle, deltaX, deltaY, minimumSize, lockAspectRatio);
  const point = sourceResizeHandlePosition(resized, handle);
  const direction = resizeHandleDirection(transform, handle, lockAspectRatio);
  if (!direction) {
    const targetX = nearestAxisTarget(point.x, targets.x, tolerance.x);
    const targetY = nearestAxisTarget(point.y, targets.y, tolerance.y);
    return {
      deltaX: deltaX + (targetX === null ? 0 : targetX - point.x),
      deltaY: deltaY + (targetY === null ? 0 : targetY - point.y),
      guides: [
        ...(targetX === null ? [] : [{ axis: 'x' as const, position: targetX }]),
        ...(targetY === null ? [] : [{ axis: 'y' as const, position: targetY }]),
      ],
    };
  }

  const axis: 'x' | 'y' = Math.abs(direction.x) >= Math.abs(direction.y) ? 'x' : 'y';
  const component = axis === 'x' ? direction.x : direction.y;
  if (Math.abs(component) < 1e-6) return { deltaX, deltaY, guides: [] };
  const target = nearestAxisTarget(axis === 'x' ? point.x : point.y, targets[axis], tolerance[axis]);
  if (target === null) return { deltaX, deltaY, guides: [] };
  const adjustment = (target - (axis === 'x' ? point.x : point.y)) / component;
  return {
    deltaX: deltaX + direction.x * adjustment,
    deltaY: deltaY + direction.y * adjustment,
    guides: [{ axis, position: target }],
  };
}

export function sourceCropFromPointer(
  transform: SourceTransform,
  crop: { top: number; right: number; bottom: number; left: number },
  sourceSize: SourceSize,
  handle: string,
  deltaX: number,
  deltaY: number,
): { transform: SourceTransform; crop: { top: number; right: number; bottom: number; left: number } } {
  const width = Math.max(1, Math.round(sourceSize.width));
  const height = Math.max(1, Math.round(sourceSize.height));
  const left = clampCropValue(crop.left, Math.min(16384, width - 1));
  const right = clampCropValue(crop.right, Math.min(16384, width - left - 1));
  const top = clampCropValue(crop.top, Math.min(16384, height - 1));
  const bottom = clampCropValue(crop.bottom, Math.min(16384, height - top - 1));
  const visibleWidth = Math.max(1, width - left - right);
  const visibleHeight = Math.max(1, height - top - bottom);
  const scaleX = transform.width / visibleWidth;
  const scaleY = transform.height / visibleHeight;
  const radians = normalizeSourceRotation(transform.rotation) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localDeltaX = cosine * deltaX + sine * deltaY;
  const localDeltaY = -sine * deltaX + cosine * deltaY;
  const widthDelta = handle.includes('e') ? localDeltaX : handle.includes('w') ? -localDeltaX : 0;
  const heightDelta = handle.includes('s') ? localDeltaY : handle.includes('n') ? -localDeltaY : 0;
  const nextCrop = { top, right, bottom, left };
  if (handle.includes('e')) nextCrop.right = cropEdge(right - widthDelta / scaleX, Math.min(16384, width - left - 1));
  if (handle.includes('w')) nextCrop.left = cropEdge(left - widthDelta / scaleX, Math.min(16384, width - right - 1));
  if (handle.includes('s')) nextCrop.bottom = cropEdge(bottom - heightDelta / scaleY, Math.min(16384, height - top - 1));
  if (handle.includes('n')) nextCrop.top = cropEdge(top - heightDelta / scaleY, Math.min(16384, height - bottom - 1));
  const nextVisibleWidth = Math.max(1, width - nextCrop.left - nextCrop.right);
  const nextVisibleHeight = Math.max(1, height - nextCrop.top - nextCrop.bottom);
  const nextWidth = Math.max(1, scaleX * nextVisibleWidth);
  const nextHeight = Math.max(1, scaleY * nextVisibleHeight);
  return {
    transform: resizeSourceToDimensions(transform, handle, nextWidth, nextHeight),
    crop: nextCrop,
  };
}

function clampCropValue(value: number, maximum: number): number {
  const finiteValue = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(maximum, Math.floor(finiteValue + 0.5 + 1e-6)));
}

function cropEdge(value: number, maximum: number): number {
  return clampCropValue(value, Math.max(0, maximum));
}

function resizeSourceToDimensions(transform: SourceTransform, handle: string, width: number, height: number): SourceTransform {
  const radians = normalizeSourceRotation(transform.rotation) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const anchorX = handle.includes('w') ? transform.width : handle.includes('e') ? 0 : transform.width / 2;
  const anchorY = handle.includes('n') ? transform.height : handle.includes('s') ? 0 : transform.height / 2;
  const centerX = transform.x + transform.width / 2;
  const centerY = transform.y + transform.height / 2;
  const fixedX = centerX + (anchorX - transform.width / 2) * cosine - (anchorY - transform.height / 2) * sine;
  const fixedY = centerY + (anchorX - transform.width / 2) * sine + (anchorY - transform.height / 2) * cosine;
  const nextAnchorX = handle.includes('w') ? width : handle.includes('e') ? 0 : width / 2;
  const nextAnchorY = handle.includes('n') ? height : handle.includes('s') ? 0 : height / 2;
  const nextCenterX = fixedX - (nextAnchorX - width / 2) * cosine + (nextAnchorY - height / 2) * sine;
  const nextCenterY = fixedY - (nextAnchorX - width / 2) * sine - (nextAnchorY - height / 2) * cosine;
  return {
    ...transform,
    x: nextCenterX - width / 2,
    y: nextCenterY - height / 2,
    width,
    height,
    rotation: normalizeSourceRotation(transform.rotation),
  };
}

/** Resizes from a named local-axis handle while keeping the opposite anchor fixed in scene space. */
export function resizeSourceFromPointer(
  transform: SourceTransform,
  handle: string,
  deltaX: number,
  deltaY: number,
  minimumSize = 16,
  lockAspectRatio = false,
): SourceTransform {
  const radians = normalizeSourceRotation(transform.rotation) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localDeltaX = cosine * deltaX + sine * deltaY;
  const localDeltaY = -sine * deltaX + cosine * deltaY;
  const widthDelta = handle.includes('e') ? localDeltaX : handle.includes('w') ? -localDeltaX : 0;
  const heightDelta = handle.includes('s') ? localDeltaY : handle.includes('n') ? -localDeltaY : 0;
  let width: number;
  let height: number;
  if (lockAspectRatio) {
    const affectsWidth = handle.includes('e') || handle.includes('w');
    const widthScale = (transform.width + widthDelta) / transform.width;
    const heightScale = (transform.height + heightDelta) / transform.height;
    const scale = affectsWidth && (handle.includes('n') || handle.includes('s'))
      ? Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale
      : affectsWidth ? widthScale : heightScale;
    const minimumScale = Math.max(minimumSize / transform.width, minimumSize / transform.height);
    const lockedScale = Math.max(minimumScale, Number.isFinite(scale) ? scale : 1);
    width = Math.max(minimumSize, Math.round(transform.width * lockedScale));
    height = Math.max(minimumSize, Math.round(transform.height * lockedScale));
  } else {
    width = Math.max(minimumSize, Math.round(transform.width + widthDelta));
    height = Math.max(minimumSize, Math.round(transform.height + heightDelta));
  }
  const resized = resizeSourceToDimensions(transform, handle, width, height);
  return { ...resized, x: Math.round(resized.x), y: Math.round(resized.y) };
}
