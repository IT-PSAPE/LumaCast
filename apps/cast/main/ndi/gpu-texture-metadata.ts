import type { exportSharedTexture } from '@lumacast/ndi-native';
import { NDI_OUTPUT_HEIGHT, NDI_OUTPUT_WIDTH } from '@lumacast/protocol';

type NativeTextureInfo = Parameters<typeof exportSharedTexture>[0];
type Plane = NonNullable<NativeTextureInfo['planes']>[number];

export interface GpuFrameMetadata {
  pixelFormat: 'bgra' | 'rgba';
  textureInfo: NativeTextureInfo;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function plane(value: unknown): value is Plane {
  return record(value) && integer(value.fd, 0, 0x7fffffff)
    && integer(value.stride, 1, 65536) && integer(value.size, 1, 128 * 1024 * 1024)
    && integer(value.offset, 0, value.size - 1);
}

/** Normalize only trusted Electron paint metadata; the original lease stays alive. */
export function readGpuFrameMetadata(value: unknown, platform: string): GpuFrameMetadata | null {
  if (!record(value) || value.widgetType !== 'frame'
    || (value.pixelFormat !== 'bgra' && value.pixelFormat !== 'rgba')
    || !record(value.codedSize) || !record(value.visibleRect)
    || value.codedSize.width !== NDI_OUTPUT_WIDTH || value.codedSize.height !== NDI_OUTPUT_HEIGHT
    || value.visibleRect.x !== 0 || value.visibleRect.y !== 0
    || value.visibleRect.width !== NDI_OUTPUT_WIDTH || value.visibleRect.height !== NDI_OUTPUT_HEIGHT) return null;

  // Electron 39 moved the platform handles under `handle`. Never fall back to
  // legacy fields when a modern handle is present but invalid.
  const modern = 'handle' in value;
  const handle = modern ? value.handle : value;
  if (!record(handle)) return null;
  let textureInfo: NativeTextureInfo;
  if (platform === 'darwin' || platform === 'win32') {
    const bytes = modern ? handle[platform === 'darwin' ? 'ioSurface' : 'ntHandle'] : handle.sharedTextureHandle;
    if (!Buffer.isBuffer(bytes) || bytes.length !== 8) return null;
    textureInfo = { sharedTextureHandle: bytes };
  } else if (platform === 'linux') {
    const pixmap = modern ? handle.nativePixmap : handle;
    if (!record(pixmap) || !Array.isArray(pixmap.planes)
      || pixmap.planes.length === 0 || pixmap.planes.length > 4 || !pixmap.planes.every(plane)) return null;
    let modifier: string | undefined;
    if (pixmap.modifier !== undefined || modern) {
      if (typeof pixmap.modifier !== 'string' || !/^(?:0|[1-9]\d*|0x[\da-f]+)$/i.test(pixmap.modifier)) return null;
      const number = BigInt(pixmap.modifier);
      if (number > 0xffffffffffffffffn) return null;
      // Native std::stoull(base=0) receives one unambiguous unsigned decimal.
      modifier = number.toString(10);
    }
    textureInfo = { planes: pixmap.planes.map(({ fd, stride, offset, size }) => ({ fd, stride, offset, size })), ...(modifier === undefined ? {} : { modifier }) };
  } else return null;
  return { pixelFormat: value.pixelFormat, textureInfo };
}
