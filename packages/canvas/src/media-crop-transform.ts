import type { MediaCrop } from '@lumacast/composition';

export type CropTransformHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface CropTransformRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComputeMediaCropGestureOptions {
  /** Current element frame, expressed in the element's unrotated local space. */
  frame: CropTransformRect;
  handle: CropTransformHandle;
  /** Pointer movement in the same local coordinate space as `frame`. */
  deltaX: number;
  deltaY: number;
  /** Full, uncropped source image bounds mapped into local element coordinates. */
  sourceDrawRect: CropTransformRect;
  /** Minimum frame edge in local units. Defaults to 16. */
  minFrameSize?: number;
}

export interface MediaCropGestureResult {
  /** New element frame in the original element's local coordinate space. */
  frame: CropTransformRect;
  /** The source-pixel region now visible inside the frame, normalized to the full source. */
  crop: MediaCrop;
  /** Where that source region sits inside the new frame, normalized to the frame. */
  cropFrame: MediaCrop;
}

/**
 * Resizes a media frame as a crop gesture while leaving the full-source draw
 * mapping fixed. The returned `crop` and `cropFrame` describe the intersection
 * of the new frame and the original full-source draw rectangle.
 */
export function computeMediaCropGesture(
  options: ComputeMediaCropGestureOptions,
): MediaCropGestureResult | null {
  const { frame, handle, deltaX, deltaY, sourceDrawRect } = options;
  const minFrameSize = options.minFrameSize ?? 16;
  if (
    !isValidRect(frame)
    || !isValidRect(sourceDrawRect)
    || !Number.isFinite(deltaX)
    || !Number.isFinite(deltaY)
    || !Number.isFinite(minFrameSize)
    || minFrameSize <= 0
  ) return null;

  const bounds = {
    left: Math.min(frame.x, sourceDrawRect.x),
    top: Math.min(frame.y, sourceDrawRect.y),
    right: Math.max(frame.x + frame.width, sourceDrawRect.x + sourceDrawRect.width),
    bottom: Math.max(frame.y + frame.height, sourceDrawRect.y + sourceDrawRect.height),
  };
  const minimumWidth = Math.min(minFrameSize, frame.width);
  const minimumHeight = Math.min(minFrameSize, frame.height);
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  const corner = (west || east) && (north || south);

  let next: CropTransformRect;
  if (corner) {
    const anchorX = west ? frame.x + frame.width : frame.x;
    const anchorY = north ? frame.y + frame.height : frame.y;
    const requestedWidth = frame.width + (east ? deltaX : -deltaX);
    const requestedHeight = frame.height + (south ? deltaY : -deltaY);
    const widthScale = requestedWidth / frame.width;
    const heightScale = requestedHeight / frame.height;
    // Let the pointer's stronger axis drive a corner resize; this preserves
    // ratio without halving a mostly-horizontal or mostly-vertical gesture.
    const requestedScale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
      ? widthScale
      : heightScale;
    const availableWidth = west ? anchorX - bounds.left : bounds.right - anchorX;
    const availableHeight = north ? anchorY - bounds.top : bounds.bottom - anchorY;
    const maximumScale = Math.min(availableWidth / frame.width, availableHeight / frame.height);
    const minimumScale = Math.max(minimumWidth / frame.width, minimumHeight / frame.height);
    const scale = clamp(requestedScale, minimumScale, maximumScale);
    const width = frame.width * scale;
    const height = frame.height * scale;
    next = {
      x: west ? anchorX - width : anchorX,
      y: north ? anchorY - height : anchorY,
      width,
      height,
    };
  } else {
    let left = frame.x;
    let right = frame.x + frame.width;
    let top = frame.y;
    let bottom = frame.y + frame.height;

    if (west) left = clamp(left + deltaX, bounds.left, right - minimumWidth);
    else if (east) right = clamp(right + deltaX, left + minimumWidth, bounds.right);
    else if (north) top = clamp(top + deltaY, bounds.top, bottom - minimumHeight);
    else if (south) bottom = clamp(bottom + deltaY, top + minimumHeight, bounds.bottom);

    next = { x: left, y: top, width: right - left, height: bottom - top };
  }

  return mapFrameToCrop(next, sourceDrawRect);
}

function mapFrameToCrop(frame: CropTransformRect, source: CropTransformRect): MediaCropGestureResult | null {
  const left = Math.max(frame.x, source.x);
  const top = Math.max(frame.y, source.y);
  const right = Math.min(frame.x + frame.width, source.x + source.width);
  const bottom = Math.min(frame.y + frame.height, source.y + source.height);
  if (right <= left || bottom <= top) return null;

  const sourceBounds = normalizedBounds(left, right, source.x, source.width, top, bottom, source.y, source.height);
  const frameBounds = normalizedBounds(left, right, frame.x, frame.width, top, bottom, frame.y, frame.height);

  return {
    frame,
    crop: sourceBounds,
    cropFrame: frameBounds,
  };
}

function normalizedBounds(
  left: number,
  right: number,
  originX: number,
  width: number,
  top: number,
  bottom: number,
  originY: number,
  height: number,
): MediaCrop {
  const x = clamp((left - originX) / width, 0, 1);
  const y = clamp((top - originY) / height, 0, 1);
  const normalizedRight = clamp((right - originX) / width, x, 1);
  const normalizedBottom = clamp((bottom - originY) / height, y, 1);
  return {
    x,
    y,
    width: Math.min(1 - x, normalizedRight - x),
    height: Math.min(1 - y, normalizedBottom - y),
  };
}

function isValidRect(rect: CropTransformRect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
