import { describe, expect, it } from 'vitest';
import {
  assertRequiredEncoders,
  assertRequiredOutputProtocols,
  assertSelfContainedMachO,
  inspectBuildConfiguration,
  mediaEngineExecutableName,
  requiredEncodersForPlatform,
  resolveMediaEngineSource,
} from '../../../../apps/stream/script/media-engine-platform.mjs';

describe('Stream media engine source resolution', () => {
  it('downloads the pinned bundle on Windows x64', () => {
    const source = resolveMediaEngineSource({ platform: 'win32', arch: 'x64', env: {}, development: false });
    expect(source.kind).toBe('download');
  });

  it('is unsupported on Windows arm64', () => {
    const source = resolveMediaEngineSource({ platform: 'win32', arch: 'arm64', env: {}, development: false });
    expect(source.kind).toBe('unsupported');
  });

  it('uses an explicit executable on macOS when LUMASTREAM_MEDIA_ENGINE is set, even outside development', () => {
    const source = resolveMediaEngineSource({
      platform: 'darwin', arch: 'arm64', env: { LUMASTREAM_MEDIA_ENGINE: '/opt/lumastream/ffmpeg' }, development: false,
    });
    expect(source).toEqual({ kind: 'explicit', executable: '/opt/lumastream/ffmpeg' });
  });

  it('falls back to the ffmpeg on PATH for macOS development with no explicit engine', () => {
    const source = resolveMediaEngineSource({ platform: 'darwin', arch: 'arm64', env: {}, development: true });
    expect(source).toEqual({ kind: 'path', command: 'ffmpeg' });
  });

  it('is unsupported on macOS outside development with no explicit engine, naming the environment variable', () => {
    const source = resolveMediaEngineSource({ platform: 'darwin', arch: 'arm64', env: {}, development: false });
    expect(source.kind).toBe('unsupported');
    expect((source as { reason: string }).reason).toContain('LUMASTREAM_MEDIA_ENGINE');
  });

  it('is unsupported on Linux', () => {
    const source = resolveMediaEngineSource({ platform: 'linux', arch: 'x64', env: {}, development: false });
    expect(source.kind).toBe('unsupported');
    expect((source as { reason: string }).reason).toContain('linux');
  });
});

describe('Stream media engine required encoders per platform', () => {
  it('requires VideoToolbox and AAC on macOS', () => {
    expect(requiredEncodersForPlatform('darwin')).toEqual(['h264_videotoolbox', 'aac']);
  });

  it('accepts an encoders listing with all required names present', () => {
    expect(() => assertRequiredEncoders('h264_videotoolbox\naac\n', 'darwin')).not.toThrow();
  });

  it('throws naming each missing encoder', () => {
    expect(() => assertRequiredEncoders('aac\n', 'darwin')).toThrow('missing required encoders for darwin: h264_videotoolbox');
    expect(() => assertRequiredEncoders('', 'darwin')).toThrow('missing required encoders for darwin: h264_videotoolbox, aac');
  });
});

describe('Stream media engine executable naming', () => {
  it('appends .exe only on Windows', () => {
    expect(mediaEngineExecutableName('win32')).toBe('ffmpeg.exe');
    expect(mediaEngineExecutableName('darwin')).toBe('ffmpeg');
  });
});

describe('Stream media engine output protocol re-export', () => {
  it('still validates RIST and SRT output support', () => {
    expect(() => assertRequiredOutputProtocols('Output:\n  rist\n  srt\n')).not.toThrow();
    expect(() => assertRequiredOutputProtocols('Output:\n  file\n')).toThrow(/missing required output protocols/);
  });
});

describe('Stream media engine build configuration inspection', () => {
  it('detects a GPL/nonfree shared build', () => {
    expect(inspectBuildConfiguration('--enable-gpl --enable-nonfree --enable-shared')).toEqual({ gpl: true, shared: true, static: false });
  });

  it('detects a static LGPL build', () => {
    expect(inspectBuildConfiguration('--disable-shared --enable-static')).toEqual({ gpl: false, shared: false, static: true });
  });

  it('treats --disable-shared as overriding --enable-shared', () => {
    expect(inspectBuildConfiguration('--enable-shared --disable-shared')).toMatchObject({ shared: false, static: true });
  });

  it('reports neither flag family when the configuration mentions none of them', () => {
    expect(inspectBuildConfiguration('--enable-libsrt --enable-librist')).toEqual({ gpl: false, shared: false, static: false });
  });
});

describe('Stream macOS media engine self-containment check', () => {
  it('accepts a binary that links only system libraries', () => {
    const otoolOutput = [
      '/opt/lumastream/vendor/ffmpeg:',
      '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)',
      '\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0, current version 1953.0.0)',
    ].join('\n');
    expect(() => assertSelfContainedMachO(otoolOutput)).not.toThrow();
  });

  it('rejects a binary that links a Homebrew dylib', () => {
    const otoolOutput = [
      '/opt/lumastream/vendor/ffmpeg:',
      '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)',
      '\t/opt/homebrew/lib/libx264.164.dylib (compatibility version 164.0.0, current version 164.0.0)',
    ].join('\n');
    expect(() => assertSelfContainedMachO(otoolOutput)).toThrow(/non-system libraries/);
    expect(() => assertSelfContainedMachO(otoolOutput)).toThrow(/libx264/);
  });
});
