const MAX_BUFFER_DIMENSION = 8192;
const MAX_BUFFER_PIXELS = 16 * 1024 * 1024;

export interface SceneSourceBufferSize {
  width: number;
  height: number;
}

/** Sizes a referenced-scene surface to its rendered bounds while capping per-source memory. */
export function sceneSourceBufferSize(
  sourceWidth: number,
  sourceHeight: number,
  pixelScaleX: number,
  pixelScaleY: number,
): SceneSourceBufferSize {
  const width = Math.max(1, Math.ceil(Math.abs(sourceWidth * pixelScaleX)));
  const height = Math.max(1, Math.ceil(Math.abs(sourceHeight * pixelScaleY)));
  const scale = Math.min(
    1,
    MAX_BUFFER_DIMENSION / width,
    MAX_BUFFER_DIMENSION / height,
    Math.sqrt(MAX_BUFFER_PIXELS / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}
