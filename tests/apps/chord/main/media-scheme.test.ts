import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_ADMITTED_FILE_SIZE_BYTES,
  MEDIA_EXTENSIONS_BY_KIND,
  MEDIA_SCHEME,
  MEDIA_SCHEME_PRIVILEGES,
  MediaAdmissions,
  buildMediaUrl,
  createMediaProtocolHandler,
  kindForPath,
  parseByteRange,
  parseMediaUrl,
} from '../../../../apps/chord/main/media-scheme';

describe('apps/chord media-scheme privileges', () => {
  it('registers a secure, standard, streaming scheme that does not bypass CSP', () => {
    expect(MEDIA_SCHEME).toBe('lumachord');
    expect(MEDIA_SCHEME_PRIVILEGES).toEqual({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    });
  });
});

describe('apps/chord buildMediaUrl / parseMediaUrl', () => {
  it('round-trips a simple absolute path', () => {
    const url = buildMediaUrl('/Users/nico/Music/song.mp3');
    expect(url).toBe('lumachord://file/%2FUsers%2Fnico%2FMusic%2Fsong.mp3');
    expect(parseMediaUrl(url)).toBe('/Users/nico/Music/song.mp3');
  });

  it('round-trips a path with spaces', () => {
    const original = '/Users/nico/Music/My Favorite Song.wav';
    expect(parseMediaUrl(buildMediaUrl(original))).toBe(original);
  });

  it('round-trips a path with unicode characters', () => {
    const original = '/Users/nico/Música/Canción 🎵.flac';
    expect(parseMediaUrl(buildMediaUrl(original))).toBe(original);
  });

  it('round-trips a Windows-style path', () => {
    const original = 'C:\\Users\\nico\\Music\\song.m4a';
    expect(parseMediaUrl(buildMediaUrl(original))).toBe(original);
  });

  it('rejects a URL on another scheme', () => {
    expect(parseMediaUrl('https://example.com/file/%2Fetc%2Fpasswd')).toBeNull();
  });

  it('rejects a URL with the wrong host segment', () => {
    expect(parseMediaUrl('lumachord://asset/%2Fetc%2Fpasswd')).toBeNull();
  });

  it('rejects an unparseable or empty value', () => {
    expect(parseMediaUrl('not a url')).toBeNull();
    expect(parseMediaUrl('')).toBeNull();
  });

  it('rejects a URL with no path segment', () => {
    expect(parseMediaUrl('lumachord://file/')).toBeNull();
    expect(parseMediaUrl('lumachord://file')).toBeNull();
  });
});

describe('apps/chord kindForPath', () => {
  it('classifies every extension in the allow-list', () => {
    for (const [kind, extensions] of Object.entries(MEDIA_EXTENSIONS_BY_KIND)) {
      for (const extension of extensions) {
        expect(kindForPath(`/a/b.${extension}`)).toBe(kind);
        expect(kindForPath(`/a/b.${extension.toUpperCase()}`)).toBe(kind);
      }
    }
  });

  it('returns null for an unknown or missing extension', () => {
    expect(kindForPath('/a/b.exe')).toBeNull();
    expect(kindForPath('/a/b')).toBeNull();
    expect(kindForPath('/a/b.')).toBeNull();
  });
});

describe('apps/chord parseByteRange', () => {
  const SIZE = 1000;

  it('parses a start-end range', () => {
    expect(parseByteRange('bytes=0-99', SIZE)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=500-599', SIZE)).toEqual({ start: 500, end: 599 });
  });

  it('parses an open-ended range (start to EOF)', () => {
    expect(parseByteRange('bytes=900-', SIZE)).toEqual({ start: 900, end: 999 });
  });

  it('parses a suffix range (last N bytes)', () => {
    expect(parseByteRange('bytes=-100', SIZE)).toEqual({ start: 900, end: 999 });
  });

  it('clamps an end beyond the file size', () => {
    expect(parseByteRange('bytes=990-5000', SIZE)).toEqual({ start: 990, end: 999 });
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(parseByteRange(' BYTES=0-9 ', SIZE)).toEqual({ start: 0, end: 9 });
  });

  it('rejects a start at or past the file size', () => {
    expect(parseByteRange('bytes=1000-', SIZE)).toBeNull();
    expect(parseByteRange('bytes=1500-', SIZE)).toBeNull();
  });

  it('rejects an end before the start', () => {
    expect(parseByteRange('bytes=100-50', SIZE)).toBeNull();
  });

  it('rejects a malformed header', () => {
    expect(parseByteRange('bytes=', SIZE)).toBeNull();
    expect(parseByteRange('items=0-9', SIZE)).toBeNull();
    expect(parseByteRange('bytes=abc-def', SIZE)).toBeNull();
  });
});

describe('apps/chord MediaAdmissions', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lumachord-admissions-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('admits an existing file whose extension matches the requested kind', async () => {
    const filePath = path.join(dir, 'song.mp3');
    writeFileSync(filePath, 'fake mp3 bytes');
    const admissions = new MediaAdmissions();

    const admitted = await admissions.admit(filePath, 'audio');

    expect(admitted).toEqual({
      kind: 'audio',
      path: filePath,
      name: 'song.mp3',
      url: buildMediaUrl(filePath),
      sizeBytes: 'fake mp3 bytes'.length,
    });
    expect(admissions.isAdmitted(filePath)).toBe(true);
    expect(admissions.kindOf(filePath)).toBe('audio');
  });

  it('gives a cue file a null url (read as text, never fetched as a scheme URL)', async () => {
    const filePath = path.join(dir, 'lyrics.lrc');
    writeFileSync(filePath, '[00:01.00]Hello');
    const admissions = new MediaAdmissions();

    const admitted = await admissions.admit(filePath, 'cues');
    expect(admitted.url).toBeNull();
  });

  it('rejects a relative path', async () => {
    const admissions = new MediaAdmissions();
    await expect(admissions.admit('song.mp3', 'audio')).rejects.toThrow(/absolute/);
  });

  it('rejects an extension that does not match the requested kind', async () => {
    const filePath = path.join(dir, 'song.mp3');
    writeFileSync(filePath, 'x');
    const admissions = new MediaAdmissions();
    await expect(admissions.admit(filePath, 'image')).rejects.toThrow(/kind/);
    expect(admissions.isAdmitted(filePath)).toBe(false);
  });

  it('rejects a file that does not exist', async () => {
    const admissions = new MediaAdmissions();
    await expect(admissions.admit(path.join(dir, 'missing.mp3'), 'audio')).rejects.toThrow(/does not exist/);
  });

  it('rejects a directory', async () => {
    const admissions = new MediaAdmissions();
    const dirPath = path.join(dir, 'not-a-file.mp3');
    // Make a directory that happens to end in .mp3.
    mkdirSync(dirPath);
    await expect(admissions.admit(dirPath, 'audio')).rejects.toThrow(/regular file/);
  });

  it('never admits a path outside the allow-list', () => {
    const admissions = new MediaAdmissions();
    expect(admissions.isAdmitted('/nope.mp3')).toBe(false);
    expect(admissions.kindOf('/nope.mp3')).toBeNull();
  });

  it('has a 4 GB size ceiling constant', () => {
    expect(MAX_ADMITTED_FILE_SIZE_BYTES).toBe(4 * 1024 * 1024 * 1024);
  });
});

describe('apps/chord createMediaProtocolHandler', () => {
  let dir: string;
  let filePath: string;
  let admissions: MediaAdmissions;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'lumachord-protocol-'));
    filePath = path.join(dir, 'clip.mp4');
    writeFileSync(filePath, Buffer.from('0123456789'));
    admissions = new MediaAdmissions();
    await admissions.admit(filePath, 'video');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function request(overrides: Partial<{ method: string; url: string; headers: Headers }> = {}) {
    return {
      method: overrides.method ?? 'GET',
      url: overrides.url ?? buildMediaUrl(filePath),
      headers: overrides.headers ?? new Headers(),
    };
  }

  it('serves an admitted file with 200 and the right content type', async () => {
    const handler = createMediaProtocolHandler(admissions);
    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('content-length')).toBe('10');
  });

  it('denies a well-formed URL for a path that was never admitted', async () => {
    const handler = createMediaProtocolHandler(admissions);
    const otherPath = path.join(dir, 'never-admitted.mp4');
    writeFileSync(otherPath, 'x');
    const response = await handler(request({ url: buildMediaUrl(otherPath) }));
    expect(response.status).toBe(403);
  });

  it('denies a malformed or foreign-scheme URL', async () => {
    const handler = createMediaProtocolHandler(admissions);
    expect((await handler(request({ url: 'https://evil.example.com' }))).status).toBe(403);
  });

  it('rejects methods other than GET/HEAD', async () => {
    const handler = createMediaProtocolHandler(admissions);
    const response = await handler(request({ method: 'POST' }));
    expect(response.status).toBe(405);
  });

  it('serves a HEAD request with no body but the same headers', async () => {
    const handler = createMediaProtocolHandler(admissions);
    const response = await handler(request({ method: 'HEAD' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('10');
  });

  it('serves a 206 partial response for a Range request', async () => {
    const handler = createMediaProtocolHandler(admissions);
    const headers = new Headers({ Range: 'bytes=2-4' });
    const response = await handler(request({ headers }));

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(response.headers.get('content-length')).toBe('3');
    const body = await response.text();
    expect(body).toBe('234');
  });

  it('serves a 206 with no body for a HEAD Range request', async () => {
    const handler = createMediaProtocolHandler(admissions);
    const headers = new Headers({ Range: 'bytes=0-1' });
    const response = await handler(request({ method: 'HEAD', headers }));
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-1/10');
  });

  it('serves a 416 for an unsatisfiable Range request', async () => {
    const handler = createMediaProtocolHandler(admissions);
    const headers = new Headers({ Range: 'bytes=9000-9999' });
    const response = await handler(request({ headers }));
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
  });

  it('returns 404 when the admitted path has since been deleted from disk', async () => {
    rmSync(filePath);
    const handler = createMediaProtocolHandler(admissions);
    const response = await handler(request());
    expect(response.status).toBe(404);
  });
});
