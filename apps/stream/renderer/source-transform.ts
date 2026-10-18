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

/** Resizes from a named local-axis handle while keeping the opposite anchor fixed in scene space. */
export function resizeSourceFromPointer(
  transform: SourceTransform,
  handle: string,
  deltaX: number,
  deltaY: number,
  minimumSize = 16,
): SourceTransform {
  const radians = normalizeSourceRotation(transform.rotation) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localDeltaX = cosine * deltaX + sine * deltaY;
  const localDeltaY = -sine * deltaX + cosine * deltaY;
  const width = Math.max(minimumSize, Math.round(transform.width + (handle.includes('e') ? localDeltaX : handle.includes('w') ? -localDeltaX : 0)));
  const height = Math.max(minimumSize, Math.round(transform.height + (handle.includes('s') ? localDeltaY : handle.includes('n') ? -localDeltaY : 0)));
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
    x: Math.round(nextCenterX - width / 2),
    y: Math.round(nextCenterY - height / 2),
    width,
    height,
    rotation: normalizeSourceRotation(transform.rotation),
  };
}
