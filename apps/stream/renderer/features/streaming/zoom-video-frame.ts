export interface ZoomVideoFramePlaneLayout {
  offset: number;
  stride: number;
}

const Y_RED = new Int32Array(256);
const Y_GREEN = new Int32Array(256);
const Y_BLUE = new Int32Array(256);

for (let value = 0; value < 256; value += 1) {
  Y_RED[value] = value * 19595;
  Y_GREEN[value] = value * 38470;
  Y_BLUE[value] = value * 7471;
}

const MAX_VIDEO_PIXELS = 3840 * 2160;

/** Converts packed RGB canvas pixels into the full-range BT.601 I420 expected by Zoom. */
export function convertZoomRgbToI420(
  source: Uint8Array,
  width: number,
  height: number,
  format: string,
  layout: readonly ZoomVideoFramePlaneLayout[],
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || width % 2 !== 0 || height % 2 !== 0 || width * height > MAX_VIDEO_PIXELS) {
    throw new Error('Zoom video frames must have even dimensions between 2×2 and 3840×2160.');
  }
  if (format !== 'RGBA' && format !== 'BGRA' && format !== 'RGBX' && format !== 'BGRX') {
    throw new Error('Zoom video frames must use RGBA, BGRA, RGBX, or BGRX pixels.');
  }

  const plane = layout[0];
  const rowBytes = width * 4;
  if (!plane || !Number.isSafeInteger(plane.offset) || plane.offset < 0
    || !Number.isSafeInteger(plane.stride) || plane.stride < rowBytes
    || plane.offset + (height - 1) * plane.stride + rowBytes > source.byteLength) {
    throw new Error('Zoom video frame layout does not match its pixel data.');
  }

  const pixelCount = width * height;
  const chromaWidth = width / 2;
  const chromaHeight = height / 2;
  const chromaPlaneSize = chromaWidth * chromaHeight;
  const output = new Uint8Array(pixelCount + chromaPlaneSize * 2);
  const yPlane = output;
  const uPlaneOffset = pixelCount;
  const vPlaneOffset = pixelCount + chromaPlaneSize;
  const redOffset = format === 'RGBA' || format === 'RGBX' ? 0 : 2;
  const blueOffset = format === 'RGBA' || format === 'RGBX' ? 2 : 0;
  const { offset, stride } = plane;

  for (let y = 0; y < height; y += 2) {
    const row0 = offset + y * stride;
    const row1 = row0 + stride;
    const yRow0 = y * width;
    const yRow1 = yRow0 + width;
    const chromaRow = (y / 2) * chromaWidth;

    for (let x = 0; x < width; x += 2) {
      const source0 = row0 + x * 4;
      const source1 = source0 + 4;
      const source2 = row1 + x * 4;
      const source3 = source2 + 4;

      const red0 = source[source0 + redOffset]!;
      const green0 = source[source0 + 1]!;
      const blue0 = source[source0 + blueOffset]!;
      const red1 = source[source1 + redOffset]!;
      const green1 = source[source1 + 1]!;
      const blue1 = source[source1 + blueOffset]!;
      const red2 = source[source2 + redOffset]!;
      const green2 = source[source2 + 1]!;
      const blue2 = source[source2 + blueOffset]!;
      const red3 = source[source3 + redOffset]!;
      const green3 = source[source3 + 1]!;
      const blue3 = source[source3 + blueOffset]!;

      yPlane[yRow0 + x] = (Y_RED[red0]! + Y_GREEN[green0]! + Y_BLUE[blue0]! + 32768) >> 16;
      yPlane[yRow0 + x + 1] = (Y_RED[red1]! + Y_GREEN[green1]! + Y_BLUE[blue1]! + 32768) >> 16;
      yPlane[yRow1 + x] = (Y_RED[red2]! + Y_GREEN[green2]! + Y_BLUE[blue2]! + 32768) >> 16;
      yPlane[yRow1 + x + 1] = (Y_RED[red3]! + Y_GREEN[green3]! + Y_BLUE[blue3]! + 32768) >> 16;

      const redSum = red0 + red1 + red2 + red3;
      const greenSum = green0 + green1 + green2 + green3;
      const blueSum = blue0 + blue1 + blue2 + blue3;
      const chromaIndex = chromaRow + x / 2;
      const u = 128 + ((-11059 * redSum - 21709 * greenSum + 32768 * blueSum + 131072) >> 18);
      const v = 128 + ((32768 * redSum - 27439 * greenSum - 5329 * blueSum + 131072) >> 18);
      output[uPlaneOffset + chromaIndex] = Math.max(0, Math.min(255, u));
      output[vPlaneOffset + chromaIndex] = Math.max(0, Math.min(255, v));
    }
  }

  return output;
}
