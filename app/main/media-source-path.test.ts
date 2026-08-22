import { describe, expect, it } from 'vitest';
import { resolveLocalMediaSourcePath } from './media-source-path';

describe('resolveLocalMediaSourcePath', () => {
  it('resolves persisted cast-media, file URL, and absolute path forms', () => {
    expect(resolveLocalMediaSourcePath('cast-media://%2Ftmp%2Fclip.mp4')).toBe('/tmp/clip.mp4');
    expect(resolveLocalMediaSourcePath('file:///tmp/clip.mp4')).toBe('/tmp/clip.mp4');
    expect(resolveLocalMediaSourcePath('/tmp/clip.mp4')).toBe('/tmp/clip.mp4');
  });

  it('preserves legacy double-encoded cast-media decoding', () => {
    expect(resolveLocalMediaSourcePath('cast-media://%252Ftmp%252Fclip.mp4')).toBe('/tmp/clip.mp4');
  });

  it('rejects remote, relative, empty, and malformed persisted sources', () => {
    expect(resolveLocalMediaSourcePath('https://example.com/clip.mp4')).toBeNull();
    expect(resolveLocalMediaSourcePath('clip.mp4')).toBeNull();
    expect(resolveLocalMediaSourcePath('')).toBeNull();
    expect(resolveLocalMediaSourcePath('cast-media://%')).toBeNull();
  });
});
