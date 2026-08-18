// Managed-media capability boundary (issue #159, parent #119).
//
// These tests exercise the registry class directly rather than the process-wide
// singleton wherever a test needs isolation, and the singleton only where the
// module-level helpers (`maskManagedMediaResult`, `resolveManagedMediaArgs`)
// are the thing under test — those close over the singleton by design, so
// asserting on them means accepting that grants accumulate across a file.
// Grants are keyed by (use, stored source), so tests use distinct paths to
// stay independent.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  ManagedMediaError,
  ManagedMediaRegistry,
  looksLikeManagedMediaReference,
  managedMediaUrl,
  maskAppSnapshot,
  maskManagedMediaResult,
  maskManagedMediaSource,
  maskSnapshotPatch,
  parseManagedMediaReference,
  resolveManagedMediaArgs,
} from './media-capability';

const POSIX_MEDIA = '/Users/someone/Movies/clip.mp4';
const POSIX_IMAGE = '/Users/someone/Pictures/logo.png';

function storedSource(filePath: string): string {
  return `cast-media://${encodeURIComponent(filePath)}`;
}

function expectedPath(filePath: string): string {
  return path.normalize(path.resolve(filePath));
}

describe('parseManagedMediaReference', () => {
  it('accepts a bare id and a full managed URL, normalizing case', () => {
    const id = `m${'a'.repeat(32)}`;
    expect(parseManagedMediaReference(id)).toEqual({ ok: true, id });
    expect(parseManagedMediaReference(`cast-media://${id}`)).toEqual({ ok: true, id });
    expect(parseManagedMediaReference(`cast-media://${id}/`)).toEqual({ ok: true, id });
    expect(parseManagedMediaReference(`cast-media://${id.toUpperCase()}`)).toEqual({ ok: true, id });
  });

  it('rejects the stored encoded-path form, which is what a path-reading attempt looks like', () => {
    // This is the pre-#159 shape and the shape a compromised renderer would
    // construct to name a file directly. It must not parse as a capability.
    expect(parseManagedMediaReference(storedSource(POSIX_MEDIA))).toEqual({
      ok: false,
      reason: 'malformed-id',
    });
    expect(parseManagedMediaReference('cast-media://%2Fetc%2Fpasswd')).toEqual({
      ok: false,
      reason: 'malformed-id',
    });
  });

  it('rejects traversal, separators, and their encoded and double-encoded forms', () => {
    const traversals = [
      'cast-media://../../etc/passwd',
      'cast-media://..%2F..%2Fetc%2Fpasswd',
      'cast-media://%2E%2E%2F%2E%2E%2Fetc',
      'cast-media://%252E%252E%252Fetc',
      'cast-media://a/b',
      'cast-media://a\\b',
      'cast-media://%5Cetc',
    ];
    for (const reference of traversals) {
      expect(parseManagedMediaReference(reference), reference).toEqual({
        ok: false,
        reason: 'malformed-id',
      });
    }
  });

  it('rejects other schemes on the scheme, not on the remainder', () => {
    const schemes = [
      'file:///etc/passwd',
      'http://example.com/x.png',
      'https://example.com/x.png',
      'blob:abc',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
    ];
    for (const reference of schemes) {
      expect(parseManagedMediaReference(reference), reference).toEqual({
        ok: false,
        reason: 'unsupported-scheme',
      });
    }
  });

  it('rejects an empty reference and an id of the wrong length or alphabet', () => {
    expect(parseManagedMediaReference('')).toEqual({ ok: false, reason: 'malformed-id' });
    expect(parseManagedMediaReference(`m${'a'.repeat(31)}`)).toEqual({ ok: false, reason: 'malformed-id' });
    expect(parseManagedMediaReference(`m${'a'.repeat(33)}`)).toEqual({ ok: false, reason: 'malformed-id' });
    expect(parseManagedMediaReference(`x${'a'.repeat(32)}`)).toEqual({ ok: false, reason: 'malformed-id' });
    expect(parseManagedMediaReference(`m${'g'.repeat(32)}`)).toEqual({ ok: false, reason: 'malformed-id' });
  });
});

describe('ManagedMediaRegistry.grant', () => {
  it('mints an opaque id that discloses no part of the path', () => {
    const registry = new ManagedMediaRegistry();
    const id = registry.grant(storedSource(POSIX_MEDIA), 'video');

    expect(id).toMatch(/^m[0-9a-f]{32}$/);
    expect(id).not.toContain('someone');
    expect(id).not.toContain('clip');
    expect(managedMediaUrl(id!)).toBe(`cast-media://${id}`);
  });

  it('reuses one id per (use, stored source) but mints distinct ids for distinct sources', () => {
    const registry = new ManagedMediaRegistry();
    const first = registry.grant(storedSource(POSIX_MEDIA), 'video');
    const again = registry.grant(storedSource(POSIX_MEDIA), 'video');
    const other = registry.grant(storedSource(POSIX_IMAGE), 'image');

    expect(again).toBe(first);
    expect(other).not.toBe(first);
    expect(registry.size).toBe(2);
  });

  it('treats the same file under a different declared use as a separate capability', () => {
    const registry = new ManagedMediaRegistry();
    const asVideo = registry.grant(storedSource(POSIX_MEDIA), 'video');
    const asAudio = registry.grant(storedSource(POSIX_MEDIA), 'audio');

    expect(asAudio).not.toBe(asVideo);
  });

  it('declines to grant a source that carries no path', () => {
    const registry = new ManagedMediaRegistry();
    expect(registry.grant('blob:abc123', 'video')).toBeNull();
    expect(registry.grant('https://example.com/x.png', 'image')).toBeNull();
    expect(registry.grant('', 'image')).toBeNull();
    expect(registry.grant('relative/path.png', 'image')).toBeNull();
    expect(registry.size).toBe(0);
  });
});

describe('ManagedMediaRegistry.resolve', () => {
  it('returns the byte-identical stored source and the normalized absolute path', () => {
    const registry = new ManagedMediaRegistry();
    const source = storedSource(POSIX_MEDIA);
    const id = registry.grant(source, 'video')!;

    const resolved = registry.resolve(managedMediaUrl(id));
    expect(resolved).toMatchObject({
      ok: true,
      id,
      use: 'video',
      // Byte-identical: this is what keeps restoreFromSnapshot from seeing a
      // spurious change on every media row.
      source,
      filePath: expectedPath(POSIX_MEDIA),
    });
  });

  it('fails an unknown id without disclosing anything', () => {
    const registry = new ManagedMediaRegistry();
    expect(registry.resolve(`cast-media://m${'b'.repeat(32)}`)).toEqual({
      ok: false,
      reason: 'unknown-id',
    });
  });

  it('reports a revoked id distinctly from an unknown one, and keeps doing so', () => {
    const registry = new ManagedMediaRegistry();
    const id = registry.grant(storedSource(POSIX_MEDIA), 'video')!;

    expect(registry.revoke(managedMediaUrl(id))).toBe(true);
    expect(registry.resolve(managedMediaUrl(id))).toEqual({ ok: false, reason: 'revoked-id' });
    // Still revoked, not downgraded to unknown, on a second attempt.
    expect(registry.resolve(managedMediaUrl(id))).toEqual({ ok: false, reason: 'revoked-id' });
    expect(registry.size).toBe(0);
  });

  it('revokeAll withdraws every live grant and keeps them distinguishable from unknown', () => {
    const registry = new ManagedMediaRegistry();
    const video = registry.grant(storedSource(POSIX_MEDIA), 'video')!;
    const image = registry.grant(storedSource(POSIX_IMAGE), 'image')!;

    registry.revokeAll();

    expect(registry.size).toBe(0);
    expect(registry.resolve(managedMediaUrl(video))).toEqual({ ok: false, reason: 'revoked-id' });
    expect(registry.resolve(managedMediaUrl(image))).toEqual({ ok: false, reason: 'revoked-id' });
  });

  it('rejects cross-family use but allows video/audio interchange', () => {
    const registry = new ManagedMediaRegistry();
    const imageId = registry.grant(storedSource(POSIX_IMAGE), 'image')!;
    const videoId = registry.grant(storedSource(POSIX_MEDIA), 'video')!;

    // An image grant fetched as a media stream, and vice versa: denied.
    expect(registry.resolve(managedMediaUrl(imageId), 'video')).toEqual({
      ok: false,
      reason: 'use-mismatch',
    });
    expect(registry.resolve(managedMediaUrl(videoId), 'image')).toEqual({
      ok: false,
      reason: 'use-mismatch',
    });

    // Within the timed-media family the distinction is not enforceable: an
    // <audio> element is a legitimate consumer of a video container.
    expect(registry.resolve(managedMediaUrl(videoId), 'audio')).toMatchObject({ ok: true });
    expect(registry.resolve(managedMediaUrl(imageId), 'image')).toMatchObject({ ok: true });
  });

  it('resolves as declared when the intended use is unknown', () => {
    // Chromium omits Sec-Fetch-Dest for some cross-scheme fetches; failing
    // closed there would break media loading outright.
    const registry = new ManagedMediaRegistry();
    const id = registry.grant(storedSource(POSIX_IMAGE), 'image')!;
    expect(registry.resolve(managedMediaUrl(id), null)).toMatchObject({ ok: true, use: 'image' });
  });
});

describe('maskManagedMediaSource', () => {
  it('replaces a path-bearing source with a managed URL and leaves non-path sources alone', () => {
    const masked = maskManagedMediaSource(storedSource(POSIX_IMAGE), 'image');
    expect(masked).toMatch(/^cast-media:\/\/m[0-9a-f]{32}$/);
    expect(masked).not.toContain('someone');

    expect(maskManagedMediaSource('blob:abc', 'video')).toBe('blob:abc');
    expect(maskManagedMediaSource('https://example.com/a.png', 'image')).toBe('https://example.com/a.png');
    expect(maskManagedMediaSource('', 'image')).toBe('');
  });

  it('is idempotent, so a value masked twice does not become a second capability', () => {
    const once = maskManagedMediaSource(storedSource('/tmp/idempotent-a.png'), 'image');
    expect(maskManagedMediaSource(once, 'image')).toBe(once);
    expect(looksLikeManagedMediaReference(once)).toBe(true);
  });
});

describe('outbound masking of RPC results', () => {
  it('masks media assets, slide backgrounds, and nested group element payloads', () => {
    const snapshot = {
      mediaAssets: [{ id: 'a1', type: 'image', src: storedSource('/tmp/mask-asset.png') }],
      slides: [{ id: 's1', background: { type: 'image', src: storedSource('/tmp/mask-bg.png') } }],
      slideElements: [
        {
          id: 'g1',
          type: 'group',
          payload: {
            children: [{ id: 'e1', type: 'video', payload: { src: storedSource('/tmp/mask-nested.mp4') } }],
          },
        },
      ],
      themes: [],
      overlays: [],
      stages: [],
    } as unknown as Parameters<typeof maskAppSnapshot>[0];

    const masked = maskAppSnapshot(snapshot) as unknown as {
      mediaAssets: { src: string }[];
      slides: { background: { src: string } }[];
      slideElements: { payload: { children: { payload: { src: string } }[] } }[];
    };

    expect(masked.mediaAssets[0].src).toMatch(/^cast-media:\/\/m[0-9a-f]{32}$/);
    expect(masked.slides[0].background.src).toMatch(/^cast-media:\/\/m[0-9a-f]{32}$/);
    expect(masked.slideElements[0].payload.children[0].payload.src).toMatch(/^cast-media:\/\/m[0-9a-f]{32}$/);
    expect(JSON.stringify(masked)).not.toContain('mask-nested.mp4');
  });

  it('masks a patch nested under a deck-mutation result wrapper', () => {
    const result = maskManagedMediaResult({
      itemId: 'deck-1',
      patch: {
        version: 3,
        deletes: {},
        upserts: { mediaAssets: [{ id: 'a1', type: 'video', src: storedSource('/tmp/mask-wrapped.mp4') }] },
      },
    }) as { patch: { upserts: { mediaAssets: { src: string }[] } } };

    expect(result.patch.upserts.mediaAssets[0].src).toMatch(/^cast-media:\/\/m[0-9a-f]{32}$/);
  });

  it('leaves results that legitimately carry a main-side path untouched', () => {
    // Export/import dialog paths, obsGetCurrentLogPath, the retained
    // pre-recovery database path: separate user-initiated capabilities.
    expect(maskManagedMediaResult('/Users/someone/Desktop/export.lcbundle')).toBe(
      '/Users/someone/Desktop/export.lcbundle',
    );
    expect(maskManagedMediaResult(null)).toBeNull();
    const unrelated = { retainedDatabasePath: '/Users/someone/Library/pre-recovery.db' };
    expect(maskManagedMediaResult(unrelated)).toBe(unrelated);
  });

  it('returns the identical object when nothing needed masking', () => {
    const patch = { version: 1, deletes: {}, upserts: { mediaAssets: [] } };
    expect(maskSnapshotPatch(patch as unknown as Parameters<typeof maskSnapshotPatch>[0]).upserts.mediaAssets)
      .toEqual([]);
  });
});

describe('inbound resolution of RPC arguments', () => {
  it('translates a managed id back to the stored source anywhere in the argument list', () => {
    const source = storedSource('/tmp/inbound-a.png');
    const masked = maskManagedMediaSource(source, 'image');

    const [id, input] = resolveManagedMediaArgs([
      'element-1',
      { payload: { src: masked }, elements: [{ payload: { src: masked } }] },
    ]) as [string, { payload: { src: string }; elements: { payload: { src: string } }[] }];

    expect(id).toBe('element-1');
    expect(input.payload.src).toBe(source);
    expect(input.elements[0].payload.src).toBe(source);
  });

  it('rejects the whole operation when a managed-shaped reference cannot resolve', () => {
    // Storing an unresolvable id would write a session-scoped token into the
    // database, so this must throw rather than pass the value through.
    const unknown = `cast-media://m${'c'.repeat(32)}`;
    expect(() => resolveManagedMediaArgs([{ src: unknown }])).toThrow(ManagedMediaError);

    try {
      resolveManagedMediaArgs([{ src: unknown }]);
    } catch (error) {
      expect(error).toBeInstanceOf(ManagedMediaError);
      // The message carries the reason only — never the id or a path.
      expect((error as ManagedMediaError).reason).toBe('unknown-id');
      expect((error as Error).message).not.toContain('c'.repeat(32));
    }
  });

  it('passes a short-lived user-selected import path through unchanged', () => {
    const importCapability = storedSource('/Users/someone/Downloads/just-picked.png');
    expect(resolveManagedMediaArgs([{ src: importCapability }])).toEqual([{ src: importCapability }]);
  });

  it('leaves non-media strings, blob URLs, and non-string values alone', () => {
    const args = [42, true, null, undefined, 'Slide title', 'blob:abc', { nested: ['a', 1] }];
    expect(resolveManagedMediaArgs(args)).toEqual(args);
  });

  it('preserves explicitly-undefined keys, which structured clone carried across IPC', () => {
    const resolved = resolveManagedMediaArgs([{ src: undefined, id: 'x' }]) as Record<string, unknown>[];
    expect('src' in resolved[0]).toBe(true);
  });
});
