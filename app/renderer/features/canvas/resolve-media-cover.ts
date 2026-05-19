import type { SlideBackgroundFit } from '@core/types';

interface MediaCoverRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaDrawRect {
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: MediaCoverRect;
}

// Resolves where to draw a media resource inside a target box for a given
// object-fit mode. `cover` crops to fill, `contain` letterboxes, `fill`
// stretches to the box exactly.
export function resolveMediaFit(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: SlideBackgroundFit,
): MediaDrawRect | null {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return null;

  if (fit === 'fill') {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }

  if (fit === 'cover') {
    const crop = resolveMediaCover(sourceWidth, sourceHeight, targetWidth, targetHeight);
    return { x: 0, y: 0, width: targetWidth, height: targetHeight, crop: crop ?? undefined };
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

export function resolveMediaCover(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): MediaCoverRect | null {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return null;

  const sourceAspectRatio = sourceWidth / sourceHeight;
  const targetAspectRatio = targetWidth / targetHeight;

  if (Math.abs(sourceAspectRatio - targetAspectRatio) < 0.0001) {
    return {
      x: 0,
      y: 0,
      width: sourceWidth,
      height: sourceHeight,
    };
  }

  if (sourceAspectRatio > targetAspectRatio) {
    const cropWidth = sourceHeight * targetAspectRatio;
    const cropX = (sourceWidth - cropWidth) / 2;

    return {
      x: cropX,
      y: 0,
      width: cropWidth,
      height: sourceHeight,
    };
  }

  const cropHeight = sourceWidth / targetAspectRatio;
  const cropY = (sourceHeight - cropHeight) / 2;

  return {
    x: 0,
    y: cropY,
    width: sourceWidth,
    height: cropHeight,
  };
}
