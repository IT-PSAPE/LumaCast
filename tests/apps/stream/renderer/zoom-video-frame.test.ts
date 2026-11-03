import { describe, expect, it } from 'vitest';
import { convertZoomRgbToI420 } from '../../../../apps/stream/renderer/features/streaming/zoom-video-frame';

describe('Zoom RGB to I420 conversion', () => {
  it('converts an opaque red RGBA frame to full-range BT.601 I420', () => {
    const pixels = new Uint8Array(2 * 2 * 4);
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([255, 0, 0, 255], offset);

    const i420 = convertZoomRgbToI420(pixels, 2, 2, 'RGBA', [{ offset: 0, stride: 8 }]);

    expect([...i420]).toEqual([76, 76, 76, 76, 85, 255]);
  });

  it('respects BGRA order, row padding, source offset, and 2×2 chroma averaging', () => {
    const source = new Uint8Array(23).fill(0xee);
    const offset = 3;
    const stride = 12;
    source.set([0, 0, 255, 255, 0, 255, 0, 255], offset);
    source.set([255, 0, 0, 255, 255, 255, 255, 255], offset + stride);

    const i420 = convertZoomRgbToI420(source, 2, 2, 'BGRA', [{ offset, stride }]);

    expect([...i420]).toEqual([76, 150, 29, 255, 128, 128]);
  });

  it.each([
    ['RGBX', [255, 0, 0, 17]],
    ['BGRX', [0, 0, 255, 17]],
  ] as const)('converts opaque %s pixels while ignoring the X byte', (format, pixel) => {
    const pixels = new Uint8Array(16);
    for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(pixel, offset);

    const i420 = convertZoomRgbToI420(pixels, 2, 2, format, [{ offset: 0, stride: 8 }]);

    expect([...i420]).toEqual([76, 76, 76, 76, 85, 255]);
  });

  it('clamps full-range chroma to the byte range', () => {
    const blue = new Uint8Array(16);
    for (let offset = 0; offset < blue.length; offset += 4) blue.set([0, 0, 255, 255], offset);

    const i420 = convertZoomRgbToI420(blue, 2, 2, 'RGBA', [{ offset: 0, stride: 8 }]);

    expect(i420[4]).toBe(255);
    expect(i420[5]).toBe(107);
  });

  it('rejects odd dimensions, unsupported pixel formats, and malformed row layouts', () => {
    const pixels = new Uint8Array(16);

    expect(() => convertZoomRgbToI420(pixels, 1, 2, 'RGBA', [{ offset: 0, stride: 4 }])).toThrow(/even dimensions/);
    expect(() => convertZoomRgbToI420(pixels, 2, 2, 'I420', [{ offset: 0, stride: 8 }])).toThrow(/RGBA, BGRA, RGBX, or BGRX/);
    expect(() => convertZoomRgbToI420(pixels, 2, 2, 'RGBA', [{ offset: 0, stride: 7 }])).toThrow(/layout/);
    expect(() => convertZoomRgbToI420(pixels, 2, 2, 'RGBA', [{ offset: 1, stride: 8 }])).toThrow(/layout/);
  });
});
