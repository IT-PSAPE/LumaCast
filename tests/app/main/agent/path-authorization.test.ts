// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PathAuthorizer,
  PathAuthorizationError,
  sniffMediaType,
  type PathDenialCode,
} from '../../../../app/main/agent/path-authorization';

// ---------------------------------------------------------------------------
// Fixture bytes
// ---------------------------------------------------------------------------

const ascii = (value: string) => Buffer.from(value, 'ascii');
const pad = (n: number) => Buffer.alloc(n, 0x00);

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad(16)]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad(16)]);
const GIF87_BYTES = Buffer.concat([ascii('GIF87a'), pad(16)]);
const GIF89_BYTES = Buffer.concat([ascii('GIF89a'), pad(16)]);
const BMP_BYTES = Buffer.concat([ascii('BM'), pad(16)]);
const WEBP_BYTES = Buffer.concat([ascii('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), ascii('WEBP'), pad(16)]);
const WAV_BYTES = Buffer.concat([ascii('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), ascii('WAVE'), pad(16)]);
const MP4_BYTES = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), ascii('ftyp'), ascii('isom'), pad(16)]);
const M4A_BYTES = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), ascii('ftyp'), ascii('M4A '), pad(16)]);
const WEBM_BYTES = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), pad(16)]);
const MP3_ID3_BYTES = Buffer.concat([ascii('ID3'), pad(16)]);
const MP3_SYNC_BYTES = Buffer.concat([Buffer.from([0xff, 0xfb]), pad(16)]);
const FLAC_BYTES = Buffer.concat([ascii('fLaC'), pad(16)]);
const OGG_BYTES = Buffer.concat([ascii('OggS'), pad(16)]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 'utf-8');
const SVG_WITH_PROLOG_BYTES = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<svg><rect/></svg>', 'utf-8');
const TEXT_BYTES = Buffer.from('This is a perfectly ordinary text file, not media.', 'utf-8');

// ---------------------------------------------------------------------------
// Fixtures / test scaffolding
// ---------------------------------------------------------------------------

let base: string;
let allowedRoot: string;
let outsideRoot: string;
let fakeHome: string;

function write(dir: string, name: string, content: Buffer): string {
  const target = path.join(dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

function authorizerFor(roots: string[], overrides: { homeDir?: string; platform?: NodeJS.Platform } = {}): PathAuthorizer {
  return new PathAuthorizer(() => roots, { homeDir: fakeHome, ...overrides });
}

async function denialCode(promise: Promise<unknown>): Promise<PathDenialCode> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PathAuthorizationError);
    return (error as PathAuthorizationError).code;
  }
  throw new Error('expected authorizeRead to reject');
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-path-auth-'));
  allowedRoot = path.join(base, 'allowed');
  outsideRoot = path.join(base, 'outside');
  fakeHome = path.join(base, 'home');
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.mkdirSync(fakeHome, { recursive: true });
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// sniffMediaType
// ---------------------------------------------------------------------------

describe('sniffMediaType', () => {
  it.each([
    ['png', PNG_BYTES, 'image'],
    ['jpeg', JPEG_BYTES, 'image'],
    ['gif87a', GIF87_BYTES, 'image'],
    ['gif89a', GIF89_BYTES, 'image'],
    ['bmp', BMP_BYTES, 'image'],
    ['webp', WEBP_BYTES, 'image'],
    ['svg', SVG_BYTES, 'image'],
    ['svg with xml prolog', SVG_WITH_PROLOG_BYTES, 'image'],
    ['mp4 (ftyp/isom)', MP4_BYTES, 'video'],
    ['webm/mkv (ebml)', WEBM_BYTES, 'video'],
    ['m4a (ftyp/M4A )', M4A_BYTES, 'audio'],
    ['wav', WAV_BYTES, 'audio'],
    ['mp3 with id3', MP3_ID3_BYTES, 'audio'],
    ['mp3 frame sync only', MP3_SYNC_BYTES, 'audio'],
    ['flac', FLAC_BYTES, 'audio'],
    ['ogg', OGG_BYTES, 'audio'],
  ] as const)('detects %s as %s', async (_label, bytes, expected) => {
    const file = write(base, `fixture-${_label.replace(/[^a-z0-9]/gi, '_')}`, bytes);
    expect(await sniffMediaType(file)).toBe(expected);
  });

  it('returns null for a plain text file', async () => {
    const file = write(base, 'plain.txt', TEXT_BYTES);
    expect(await sniffMediaType(file)).toBeNull();
  });

  it('returns null for an empty file', async () => {
    const file = write(base, 'empty.bin', Buffer.alloc(0));
    expect(await sniffMediaType(file)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PathAuthorizer.authorizeRead
// ---------------------------------------------------------------------------

describe('PathAuthorizer.authorizeRead', () => {
  it('authorizes a valid media file inside an allowed root and returns its realpath, size, and detected type', async () => {
    const file = write(allowedRoot, 'photo.png', PNG_BYTES);
    const authorizer = authorizerFor([allowedRoot]);

    const result = await authorizer.authorizeRead(file, { purpose: 'media' });

    expect(result.path).toBe(fs.realpathSync(file));
    expect(result.size).toBe(PNG_BYTES.length);
    expect(result.detectedType).toBe('image');
  });

  it('denies a relative path as not-absolute', async () => {
    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(authorizer.authorizeRead('relative/path.png', { purpose: 'media' }));
    expect(code).toBe('not-absolute');
  });

  it('denies a path that does not exist as unreadable', async () => {
    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(
      authorizer.authorizeRead(path.join(allowedRoot, 'nope.png'), { purpose: 'media' }),
    );
    expect(code).toBe('unreadable');
  });

  it('denies a file outside every allowed root', async () => {
    const file = write(outsideRoot, 'photo.png', PNG_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(authorizer.authorizeRead(file, { purpose: 'media' }));
    expect(code).toBe('outside-allowed-roots');
  });

  it('does not let a root name collide by string prefix (e.g. /a/Docs vs /a/Documents)', async () => {
    const docsRoot = path.join(base, 'Docs');
    const collidingDir = path.join(base, 'Docs-collision');
    fs.mkdirSync(docsRoot, { recursive: true });
    const file = write(collidingDir, 'photo.png', PNG_BYTES);

    const authorizer = authorizerFor([docsRoot]);
    const code = await denialCode(authorizer.authorizeRead(file, { purpose: 'media' }));
    expect(code).toBe('outside-allowed-roots');
  });

  it('denies a symlink inside an allowed root that escapes to a file outside it', async () => {
    const secret = write(outsideRoot, 'secret.png', PNG_BYTES);
    const link = path.join(allowedRoot, 'link-to-secret.png');
    fs.symlinkSync(secret, link);

    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(authorizer.authorizeRead(link, { purpose: 'media' }));
    expect(code).toBe('outside-allowed-roots');
  });

  it('denies a hidden directory segment inside an allowed root', async () => {
    const file = write(path.join(allowedRoot, '.hidden'), 'photo.png', PNG_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(authorizer.authorizeRead(file, { purpose: 'media' }));
    expect(code).toBe('hidden-path');
  });

  it('denies a hidden (dotfile) file directly inside an allowed root', async () => {
    const file = write(allowedRoot, '.photo.png', PNG_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(authorizer.authorizeRead(file, { purpose: 'media' }));
    expect(code).toBe('hidden-path');
  });

  it('denies a directory as not-a-file', async () => {
    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(authorizer.authorizeRead(allowedRoot, { purpose: 'media' }));
    expect(code).toBe('not-a-file');
  });

  it('denies a file over the purpose default (media) via an explicit override', async () => {
    const file = write(allowedRoot, 'photo.png', PNG_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(authorizer.authorizeRead(file, { purpose: 'media', maxBytes: 4 }));
    expect(code).toBe('too-large');
  });

  it('denies a document over its override size limit', async () => {
    const file = write(allowedRoot, 'notes.txt', TEXT_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(authorizer.authorizeRead(file, { purpose: 'document', maxBytes: 4 }));
    expect(code).toBe('too-large');
  });

  it('accepts a small file under the default purpose size limits without an override', async () => {
    const mediaFile = write(allowedRoot, 'photo.png', PNG_BYTES);
    const documentFile = write(allowedRoot, 'notes.txt', TEXT_BYTES);
    const authorizer = authorizerFor([allowedRoot]);

    await expect(authorizer.authorizeRead(mediaFile, { purpose: 'media' })).resolves.toMatchObject({ detectedType: 'image' });
    await expect(authorizer.authorizeRead(documentFile, { purpose: 'document' })).resolves.toMatchObject({ detectedType: null });
  });

  it('denies a non-media file for purpose media as unsupported-type', async () => {
    const file = write(allowedRoot, 'notes.txt', TEXT_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(authorizer.authorizeRead(file, { purpose: 'media' }));
    expect(code).toBe('unsupported-type');
  });

  it('accepts a media file whose declaredType matches the sniffed type', async () => {
    const file = write(allowedRoot, 'photo.png', PNG_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    const result = await authorizer.authorizeRead(file, { purpose: 'media', declaredType: 'image' });
    expect(result.detectedType).toBe('image');
  });

  it('denies a media file whose declaredType does not match the sniffed type', async () => {
    const file = write(allowedRoot, 'photo.png', PNG_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    const code = await denialCode(authorizer.authorizeRead(file, { purpose: 'media', declaredType: 'video' }));
    expect(code).toBe('type-mismatch');
  });

  it('never sniffs for purpose document, so an unrecognizable file still succeeds', async () => {
    const file = write(allowedRoot, 'notes.txt', TEXT_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    const result = await authorizer.authorizeRead(file, { purpose: 'document', declaredType: 'image' });
    expect(result.detectedType).toBeNull();
  });

  describe('system and credential paths (deny-list wins over the allow-list)', () => {
    const credentialSubpaths: string[] = [
      '.ssh/id_rsa',
      '.aws/credentials',
      '.gnupg/secring.gpg',
      '.config/gcloud/credentials.db',
      '.kube/config',
      '.docker/config.json',
      '.npmrc',
      '.netrc',
      'Library/Keychains/login.keychain',
      'Library/Cookies/Cookies.binarycookies',
      'Library/Application Support/SomeApp/token.json',
    ];

    it.each(credentialSubpaths)('denies ~/%s even when the home directory is itself an allowed root', async (subpath) => {
      const file = write(fakeHome, subpath, ascii('secret'));
      // The fake home dir is the allowed root: without deny-list precedence
      // this would otherwise be readable.
      const authorizer = authorizerFor([fakeHome]);
      const code = await denialCode(authorizer.authorizeRead(file, { purpose: 'document' }));
      expect(code).toBe('system-path');
    });

    it('denies a .env file anywhere, including inside a granted root', async () => {
      const file = write(allowedRoot, '.env', ascii('SECRET=1'));
      const authorizer = authorizerFor([allowedRoot]);
      const code = await denialCode(authorizer.authorizeRead(file, { purpose: 'document' }));
      expect(code).toBe('system-path');
    });

    it('denies a real system path (/etc/hosts) even with no allowed roots at all', async () => {
      if (!fs.existsSync('/etc/hosts')) return;
      const authorizer = authorizerFor([]);
      const code = await denialCode(authorizer.authorizeRead('/etc/hosts', { purpose: 'document' }));
      expect(code).toBe('system-path');
    });

    it('does not deny files under the granted root merely for living under the fake home directory', async () => {
      // Sanity check for the credential-path tests above: a file directly
      // under the fake home (outside every specific credential subtree)
      // is not itself denied by the credential rules.
      const file = write(fakeHome, 'ordinary.txt', TEXT_BYTES);
      const authorizer = authorizerFor([fakeHome]);
      const result = await authorizer.authorizeRead(file, { purpose: 'document' });
      expect(result.size).toBe(TEXT_BYTES.length);
    });
  });

  it('is unaffected by an injected win32 platform when actually running against POSIX paths', async () => {
    const file = write(allowedRoot, 'photo.png', PNG_BYTES);
    const authorizer = authorizerFor([allowedRoot], { platform: 'win32' });
    const result = await authorizer.authorizeRead(file, { purpose: 'media' });
    expect(result.detectedType).toBe('image');
  });
});

// ---------------------------------------------------------------------------
// PathAuthorizer.isWithinAllowedRoots
// ---------------------------------------------------------------------------

describe('PathAuthorizer.isWithinAllowedRoots', () => {
  it('returns true for a realpath inside an allowed root', () => {
    const file = write(allowedRoot, 'photo.png', PNG_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    expect(authorizer.isWithinAllowedRoots(fs.realpathSync(file))).toBe(true);
  });

  it('returns false for a realpath outside every allowed root', () => {
    const file = write(outsideRoot, 'photo.png', PNG_BYTES);
    const authorizer = authorizerFor([allowedRoot]);
    expect(authorizer.isWithinAllowedRoots(fs.realpathSync(file))).toBe(false);
  });

  it('returns false rather than throwing when a configured root no longer exists', () => {
    const missingRoot = path.join(base, 'does-not-exist');
    const file = write(allowedRoot, 'photo.png', PNG_BYTES);
    const authorizer = authorizerFor([missingRoot]);
    expect(() => authorizer.isWithinAllowedRoots(fs.realpathSync(file))).not.toThrow();
    expect(authorizer.isWithinAllowedRoots(fs.realpathSync(file))).toBe(false);
  });

  it('does not match a root by string prefix collision', () => {
    const docsRoot = path.join(base, 'Docs');
    const collidingDir = path.join(base, 'Docs-collision');
    fs.mkdirSync(docsRoot, { recursive: true });
    const file = write(collidingDir, 'photo.png', PNG_BYTES);

    const authorizer = authorizerFor([docsRoot]);
    expect(authorizer.isWithinAllowedRoots(fs.realpathSync(file))).toBe(false);
  });

  it('returns true for the root path itself, not only its descendants', () => {
    const authorizer = authorizerFor([allowedRoot]);
    expect(authorizer.isWithinAllowedRoots(fs.realpathSync(allowedRoot))).toBe(true);
  });
});
