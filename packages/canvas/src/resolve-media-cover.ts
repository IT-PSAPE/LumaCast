import type { MediaCrop, SlideBackgroundFit } from '@lumacast/composition';

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
  normalizedCrop?: MediaCrop | null,
  normalizedCropFrame?: MediaCrop | null,
): MediaDrawRect | null {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) return null;

  if (normalizedCropFrame) {
    const frameX = targetWidth * normalizedCropFrame.x;
    const frameY = targetHeight * normalizedCropFrame.y;
    const frameWidth = targetWidth * normalizedCropFrame.width;
    const frameHeight = targetHeight * normalizedCropFrame.height;
    const draw = resolveMediaFit(sourceWidth, sourceHeight, frameWidth, frameHeight, fit, normalizedCrop);
    if (!draw) return null;
    return { ...draw, x: draw.x + frameX, y: draw.y + frameY };
  }

  // With no authored crop, preserve the long-standing object-fit behavior
  // and crop values exactly. Authored coordinates select a source region first;
  // cover may then crop further within that region to match the target box.
  if (normalizedCrop) {
    const base = {
      x: normalizedCrop.x * sourceWidth,
      y: normalizedCrop.y * sourceHeight,
      width: normalizedCrop.width * sourceWidth,
      height: normalizedCrop.height * sourceHeight,
    };

    if (fit === 'fill') {
      return { x: 0, y: 0, width: targetWidth, height: targetHeight, crop: base };
    }

    if (fit === 'cover') {
      const cover = resolveMediaCover(base.width, base.height, targetWidth, targetHeight);
      if (!cover) return null;
      return {
        x: 0,
        y: 0,
        width: targetWidth,
        height: targetHeight,
        crop: { ...cover, x: cover.x + base.x, y: cover.y + base.y },
      };
    }

    const scale = Math.min(targetWidth / base.width, targetHeight / base.height);
    const width = base.width * scale;
    const height = base.height * scale;
    return {
      x: (targetWidth - width) / 2,
      y: (targetHeight - height) / 2,
      width,
      height,
      crop: base,
    };
  }

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
