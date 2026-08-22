import { afterEach, describe, expect, it } from 'vitest';
import {
  buildMediaLibraryReference,
  getMediaLibraryDirectory,
  isBrokenMediaSource,
  isMediaLibraryReference,
  mediaLibraryFileName,
  resolveLocalMediaSourcePath,
  setMediaLibraryDirectory,
  toCastMediaSource,
} from './media-source-utils';

const VALID_HASH = 'a'.repeat(64);
const VALID_REFERENCE = `cast-media://library/${VALID_HASH}.mp4`;

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

  it('still resolves a legacy cast-media encoded absolute path exactly as before (regression)', () => {
    expect(resolveLocalMediaSourcePath('cast-media://%2Ftmp%2Fclip.mp4')).toBe('/tmp/clip.mp4');
  });
});

describe('media library references', () => {
  afterEach(() => {
    setMediaLibraryDirectory(null);
  });

  it('resolves a valid library reference under the configured directory', () => {
    setMediaLibraryDirectory('/userData/media');
    expect(resolveLocalMediaSourcePath(VALID_REFERENCE)).toBe(`/userData/media/${VALID_HASH}.mp4`);
  });

  it('resolves a library reference with no extension', () => {
    setMediaLibraryDirectory('/userData/media');
    expect(resolveLocalMediaSourcePath(`cast-media://library/${VALID_HASH}`)).toBe(
      `/userData/media/${VALID_HASH}`,
    );
  });

  it('returns null for a valid library reference with no directory configured', () => {
    expect(getMediaLibraryDirectory()).toBeNull();
    expect(resolveLocalMediaSourcePath(VALID_REFERENCE)).toBeNull();
  });

  it('rejects a hash of the wrong length', () => {
    setMediaLibraryDirectory('/userData/media');
    expect(resolveLocalMediaSourcePath(`cast-media://library/${'a'.repeat(63)}`)).toBeNull();
    expect(resolveLocalMediaSourcePath(`cast-media://library/${'a'.repeat(65)}`)).toBeNull();
  });

  it('rejects uppercase hex', () => {
    setMediaLibraryDirectory('/userData/media');
    expect(resolveLocalMediaSourcePath(`cast-media://library/${'A'.repeat(64)}`)).toBeNull();
  });

  it('rejects a payload containing ..', () => {
    setMediaLibraryDirectory('/userData/media');
    expect(resolveLocalMediaSourcePath('cast-media://library/../../etc/passwd')).toBeNull();
  });

  it('rejects a payload containing a separator', () => {
    setMediaLibraryDirectory('/userData/media');
    expect(resolveLocalMediaSourcePath(`cast-media://library/${VALID_HASH}/extra`)).toBeNull();
  });

  it('rejects a payload containing a percent-encoded separator', () => {
    setMediaLibraryDirectory('/userData/media');
    expect(resolveLocalMediaSourcePath(`cast-media://library/${VALID_HASH}%2Ffoo`)).toBeNull();
  });

  it('rejects an over-long extension', () => {
    setMediaLibraryDirectory('/userData/media');
    expect(resolveLocalMediaSourcePath(`cast-media://library/${VALID_HASH}.${'a'.repeat(13)}`)).toBeNull();
  });

  it('rejects an illegal extension', () => {
    setMediaLibraryDirectory('/userData/media');
    expect(resolveLocalMediaSourcePath(`cast-media://library/${VALID_HASH}.M4V`)).toBeNull();
    expect(resolveLocalMediaSourcePath(`cast-media://library/${VALID_HASH}.mp-4`)).toBeNull();
  });

  it('mediaLibraryFileName extracts the file name from a valid reference and null otherwise', () => {
    expect(mediaLibraryFileName(VALID_REFERENCE)).toBe(`${VALID_HASH}.mp4`);
    expect(mediaLibraryFileName('cast-media://%2Ftmp%2Fclip.mp4')).toBeNull();
    expect(mediaLibraryFileName(`cast-media://library/${'A'.repeat(64)}`)).toBeNull();
  });

  it('isMediaLibraryReference is true only for well-formed library references', () => {
    expect(isMediaLibraryReference(VALID_REFERENCE)).toBe(true);
    expect(isMediaLibraryReference('cast-media://%2Ftmp%2Fclip.mp4')).toBe(false);
    expect(isMediaLibraryReference(`cast-media://library/${'A'.repeat(64)}`)).toBe(false);
  });

  it('buildMediaLibraryReference wraps a valid file name and throws on an invalid one', () => {
    expect(buildMediaLibraryReference(`${VALID_HASH}.mp4`)).toBe(VALID_REFERENCE);
    expect(() => buildMediaLibraryReference('not-a-hash')).toThrow();
    expect(() => buildMediaLibraryReference(`${VALID_HASH}/../x`)).toThrow();
  });
});

describe('toCastMediaSource', () => {
  afterEach(() => {
    setMediaLibraryDirectory(null);
  });

  it('passes a library reference through unchanged, with or without a configured directory', () => {
    expect(toCastMediaSource(VALID_REFERENCE)).toBe(VALID_REFERENCE);
    setMediaLibraryDirectory('/userData/media');
    expect(toCastMediaSource(VALID_REFERENCE)).toBe(VALID_REFERENCE);
  });

  it('still wraps a plain absolute path as an encoded cast-media source (regression)', () => {
    expect(toCastMediaSource('/tmp/clip.mp4')).toBe(`cast-media://${encodeURIComponent('/tmp/clip.mp4')}`);
  });
});

describe('isBrokenMediaSource', () => {
  afterEach(() => {
    setMediaLibraryDirectory(null);
  });

  it('does not consider a library reference broken when no directory is configured', () => {
    // Unresolvable right now is not the same as proven missing: see the
    // comment on isBrokenMediaSource in media-source-utils.ts.
    expect(isBrokenMediaSource(VALID_REFERENCE)).toBe(false);
  });

  it('considers a library reference broken when the configured directory does not contain the file', () => {
    setMediaLibraryDirectory('/nonexistent-media-library-dir');
    expect(isBrokenMediaSource(VALID_REFERENCE)).toBe(true);
  });
});
