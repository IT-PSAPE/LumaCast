import { describe, expect, it } from 'vitest';
import { readGpuFrameMetadata } from '../../../../../apps/cast/main/ndi/gpu-texture-metadata';

const frame = {
  widgetType: 'frame', pixelFormat: 'bgra', codedSize: { width: 1920, height: 1080 },
  visibleRect: { x: 0, y: 0, width: 1920, height: 1080 },
};
const plane = { fd: 7, stride: 7680, offset: 0, size: 1920 * 1080 * 4 };

describe('trusted Electron GPU metadata boundary', () => {
  it.each(['darwin', 'win32'])('preserves the legacy %s handle without copying texture bytes', (platform) => {
    const handle = Buffer.alloc(8, 1);
    const result = readGpuFrameMetadata({ ...frame, sharedTextureHandle: handle }, platform);
    expect(result).toEqual({ pixelFormat: 'bgra', textureInfo: { sharedTextureHandle: handle } });
    expect(result?.textureInfo.sharedTextureHandle).toBe(handle);
  });

  it.each([['darwin', 'ioSurface'], ['win32', 'ntHandle']])('maps modern %s platform handles to the native export contract', (platform, key) => {
    const handle = Buffer.alloc(8, 2);
    const result = readGpuFrameMetadata({ ...frame, pixelFormat: 'rgba', handle: { [key]: handle } }, platform!);
    expect(result).toEqual({ pixelFormat: 'rgba', textureInfo: { sharedTextureHandle: handle } });
    expect(result?.textureInfo.sharedTextureHandle).toBe(handle);
  });

  it('normalizes modern Linux planes and modifier into one detached native descriptor', () => {
    const result = readGpuFrameMetadata({ ...frame, handle: { nativePixmap: { planes: [plane], modifier: '0xabcdef' } } }, 'linux');
    expect(result).toEqual({ pixelFormat: 'bgra', textureInfo: { planes: [plane], modifier: '11259375' } });
    expect(result?.textureInfo.planes?.[0]).not.toBe(plane);
  });

  it('retains legacy Linux modifier defaults and the full unsigned modifier range', () => {
    expect(readGpuFrameMetadata({ ...frame, planes: [plane] }, 'linux')?.textureInfo).toEqual({ planes: [plane] });
    expect(readGpuFrameMetadata({ ...frame, handle: { nativePixmap: { planes: [plane], modifier: '18446744073709551615' } } }, 'linux')?.textureInfo.modifier)
      .toBe('18446744073709551615');
  });

  it.each([null, undefined, {}, { ...frame, codedSize: null }, { ...frame, visibleRect: null },
    { ...frame, widgetType: 'popup' }, { ...frame, pixelFormat: 'nv12' },
    { ...frame, codedSize: { width: 960, height: 540 } },
    { ...frame, visibleRect: { x: 1, y: 0, width: 1920, height: 1080 } }])
  ('rejects malformed, cropped and unsupported geometry without throwing', (info) => {
    expect(readGpuFrameMetadata(info, 'darwin')).toBeNull();
  });

  it.each([null, {}, { ntHandle: Buffer.alloc(8) }, { ioSurface: Buffer.alloc(4) }, { ioSurface: new Uint8Array(8) }])
  ('does not fall back to legacy capabilities when a modern handle is invalid', (handle) => {
    expect(readGpuFrameMetadata({ ...frame, handle, sharedTextureHandle: Buffer.alloc(8) }, 'darwin')).toBeNull();
  });

  it.each(['-1', '1.5', '08', '0x', '12junk', '18446744073709551616', ''])('rejects invalid Linux modifier %s', (modifier) => {
    expect(readGpuFrameMetadata({ ...frame, handle: { nativePixmap: { planes: [plane], modifier } } }, 'linux')).toBeNull();
  });

  it.each([{ fd: -1 }, { fd: 0.5 }, { stride: 0 }, { stride: 65537 }, { offset: -1 },
    { offset: plane.size }, { size: Infinity }, { size: 128 * 1024 * 1024 + 1 }])
  ('rejects invalid DMA-BUF plane bounds', (patch) => {
    expect(readGpuFrameMetadata({ ...frame, handle: { nativePixmap: { planes: [{ ...plane, ...patch }], modifier: '0' } } }, 'linux')).toBeNull();
  });

  it('rejects missing or excessive planes, wrong-platform handles and unsupported platforms', () => {
    for (const planes of [[], Array.from({ length: 5 }, () => plane)]) {
      expect(readGpuFrameMetadata({ ...frame, planes }, 'linux')).toBeNull();
    }
    expect(readGpuFrameMetadata({ ...frame, handle: { ioSurface: Buffer.alloc(8) } }, 'win32')).toBeNull();
    expect(readGpuFrameMetadata({ ...frame, sharedTextureHandle: Buffer.alloc(8) }, 'other')).toBeNull();
  });
});
