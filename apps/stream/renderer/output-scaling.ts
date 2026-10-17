export interface VideoSize {
  width: number;
  height: number;
}

export interface VideoPoint {
  x: number;
  y: number;
}

export interface VideoRect extends VideoPoint, VideoSize {}

export interface CanvasViewport extends VideoRect {
  scale: number;
}

export const SCALED_OUTPUT_LIMITS = {
  minWidth: 320,
  maxWidth: 7680,
  minHeight: 240,
  maxHeight: 4320,
} as const;

const ZERO_VIEWPORT: CanvasViewport = { x: 0, y: 0, width: 0, height: 0, scale: 0 };

function hasPositiveFiniteSize(size: VideoSize): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}

function clampEven(value: number, minimum: number, maximum: number): number {
  const finiteValue = Number.isFinite(value) ? value : minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(finiteValue / 2) * 2));
}

export function clampScaledOutputSize(size: VideoSize): VideoSize {
  return {
    width: clampEven(size.width, SCALED_OUTPUT_LIMITS.minWidth, SCALED_OUTPUT_LIMITS.maxWidth),
    height: clampEven(size.height, SCALED_OUTPUT_LIMITS.minHeight, SCALED_OUTPUT_LIMITS.maxHeight),
  };
}

export function fitCanvasToOutput(canvas: VideoSize, output: VideoSize): CanvasViewport {
  if (!hasPositiveFiniteSize(canvas) || !hasPositiveFiniteSize(output)) return { ...ZERO_VIEWPORT };
  const scale = Math.min(output.width / canvas.width, output.height / canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  return {
    x: (output.width - width) / 2,
    y: (output.height - height) / 2,
    width,
    height,
    scale,
  };
}

export function canvasPointFromOutputPoint(point: VideoPoint, canvas: VideoSize, output: VideoSize): VideoPoint {
  const viewport = fitCanvasToOutput(canvas, output);
  if (!viewport.scale || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { x: 0, y: 0 };
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

export function outputRectFromCanvasRect(rect: VideoRect, canvas: VideoSize, output: VideoSize): VideoRect {
  const viewport = fitCanvasToOutput(canvas, output);
  if (!viewport.scale || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    || rect.width < 0 || rect.height < 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: viewport.x + rect.x * viewport.scale,
    y: viewport.y + rect.y * viewport.scale,
    width: rect.width * viewport.scale,
    height: rect.height * viewport.scale,
  };
}
