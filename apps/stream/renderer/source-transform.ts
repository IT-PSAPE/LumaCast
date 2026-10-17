import type { SourceTransform } from '../shared/desktop-api';

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
