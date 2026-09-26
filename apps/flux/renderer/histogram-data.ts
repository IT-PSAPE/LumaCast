export type HistogramData = {
  channels: number[][];
  pixels: number;
  shadows: number;
  highlights: number;
  shadowChannels: number;
  highlightChannels: number;
};
export type PixelReadout = [number, number, number] | null;
export function histogram(
  data: Uint8ClampedArray,
  width = data.length / 4,
  crop?: { x: number; y: number; width: number; height: number },
): HistogramData {
  const result: HistogramData = {
    channels: Array.from({ length: 3 }, () => Array(256).fill(0)),
    pixels: 0,
    shadows: 0,
    highlights: 0,
    shadowChannels: 0,
    highlightChannels: 0,
  };
  const height = width ? data.length / 4 / width : 0;
  const left = crop ? Math.max(0, Math.floor(crop.x * width)) : 0;
  const right = crop
    ? Math.min(width, Math.ceil((crop.x + crop.width) * width))
    : width;
  const top = crop ? Math.max(0, Math.floor(crop.y * height)) : 0;
  const bottom = crop
    ? Math.min(height, Math.ceil((crop.y + crop.height) * height))
    : height;
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      result.pixels++;
      let shadow = false,
        highlight = false;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        result.channels[c][v]++;
        if (v === 0) {
          result.shadowChannels |= 1 << c;
          shadow = true;
        }
        if (v === 255) {
          result.highlightChannels |= 1 << c;
          highlight = true;
        }
      }
      if (shadow) result.shadows++;
      if (highlight) result.highlights++;
    }
  return result;
}
export function clippingPixels(
  data: Uint8ClampedArray,
  shadows: boolean,
  highlights: boolean,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(data.length);
  if (!shadows && !highlights) return out;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    if (highlights && Math.max(data[i], data[i + 1], data[i + 2]) === 255) {
      out[i] = 255;
      out[i + 3] = 210;
    } else if (shadows && Math.min(data[i], data[i + 1], data[i + 2]) === 0) {
      out[i + 2] = 255;
      out[i + 3] = 210;
    }
  }
  return out;
}
export function samplePixel(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): PixelReadout {
  if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
  const i = (Math.floor(y * height) * width + Math.floor(x * width)) * 4;
  return data[i + 3] ? [data[i], data[i + 1], data[i + 2]] : null;
}
