// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSnapshot, MediaLibraryProgress, SnapshotPatch } from '@lumacast/protocol';
import { MediaLibraryService, type MediaLibraryAdoptionRepository, type MediaLibraryReclaimRepository } from './media-library';
import { isMediaLibraryReference, resolveLocalMediaSourcePath, setMediaLibraryDirectory } from './media-source-path';

let userDataPath: string;
let sourceDir: string;

function castMediaSource(filePath: string): string {
  return `cast-media://${encodeURIComponent(filePath)}`;
}

function writeSource(name: string, contents: string): string {
  const filePath = path.join(sourceDir, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function libraryFiles(): string[] {
  const directory = path.join(userDataPath, 'media');
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

describe('MediaLibraryService', () => {
  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-media-library-'));
    userDataPath = path.join(root, 'userData');
    sourceDir = path.join(root, 'elsewhere');
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    setMediaLibraryDirectory(null);
    fs.rmSync(path.dirname(userDataPath), { recursive: true, force: true });
  });

  it('copies an imported file into the library and returns a reference to the copy', async () => {
    const library = new MediaLibraryService(userDataPath);
    const original = writeSource('logo.png', 'png-bytes');

    const stored = await library.adopt(castMediaSource(original));

    expect(isMediaLibraryReference(stored)).toBe(true);
    expect(libraryFiles()).toHaveLength(1);
    expect(fs.readFileSync(resolveLocalMediaSourcePath(stored)!, 'utf8')).toBe('png-bytes');
  });

  it('keeps working after the original is deleted, which is the point of copying', async () => {
    const library = new MediaLibraryService(userDataPath);
    const original = writeSource('clip.mp4', 'mp4-bytes');
    const stored = await library.adopt(castMediaSource(original));

    fs.rmSync(original);

    expect(fs.readFileSync(resolveLocalMediaSourcePath(stored)!, 'utf8')).toBe('mp4-bytes');
  });

  it('stores one copy for identical bytes imported twice', async () => {
    const library = new MediaLibraryService(userDataPath);
    const first = await library.adopt(castMediaSource(writeSource('a.png', 'same')));
    const second = await library.adopt(castMediaSource(writeSource('b.png', 'same')));

    expect(second).toBe(first);
    expect(libraryFiles()).toHaveLength(1);
  });

  it('stores separate copies for different bytes and preserves the extension', async () => {
    const library = new MediaLibraryService(userDataPath);
    const first = await library.adopt(castMediaSource(writeSource('a.png', 'one')));
    const second = await library.adopt(castMediaSource(writeSource('b.jpeg', 'two')));

    expect(second).not.toBe(first);
    expect(libraryFiles()).toHaveLength(2);
    expect(libraryFiles().some((name) => name.endsWith('.png'))).toBe(true);
    expect(libraryFiles().some((name) => name.endsWith('.jpeg'))).toBe(true);
  });

  it('returns an existing library reference untouched instead of copying it again', async () => {
    const library = new MediaLibraryService(userDataPath);
    const stored = await library.adopt(castMediaSource(writeSource('logo.png', 'png-bytes')));

    expect(await library.adopt(stored)).toBe(stored);
    expect(libraryFiles()).toHaveLength(1);
  });

  it('references a file that already lives in the library rather than copying it', async () => {
    const library = new MediaLibraryService(userDataPath);
    const stored = await library.adopt(castMediaSource(writeSource('logo.png', 'png-bytes')));
    const insideLibrary = resolveLocalMediaSourcePath(stored)!;

    expect(await library.adopt(castMediaSource(insideLibrary))).toBe(stored);
    expect(libraryFiles()).toHaveLength(1);
  });

  it('replaces a truncated copy left behind by an interrupted import', async () => {
    const library = new MediaLibraryService(userDataPath);
    const original = writeSource('logo.png', 'complete-bytes');
    const stored = await library.adopt(castMediaSource(original));
    const target = resolveLocalMediaSourcePath(stored)!;
    fs.writeFileSync(target, 'trunc');

    expect(await library.adopt(castMediaSource(original))).toBe(stored);
    expect(fs.readFileSync(target, 'utf8')).toBe('complete-bytes');
  });

  it('leaves no partial file behind when a copy fails', async () => {
    const library = new MediaLibraryService(userDataPath);

    await expect(library.adopt(castMediaSource(path.join(sourceDir, 'absent.png')))).rejects.toThrow();

    expect(libraryFiles()).toEqual([]);
  });

  it('rejects a directory presented as a media source', async () => {
    const library = new MediaLibraryService(userDataPath);

    await expect(library.adopt(castMediaSource(sourceDir))).rejects.toThrow();
  });

  it('passes through sources that carry no local file', async () => {
    const library = new MediaLibraryService(userDataPath);

    for (const source of ['', 'blob:abc123', 'https://example.com/a.png', 'relative/a.png']) {
      expect(await library.adopt(source)).toBe(source);
    }
    expect(libraryFiles()).toEqual([]);
  });

  it('configures the library directory for stored-reference resolution', () => {
    const library = new MediaLibraryService(userDataPath);

    expect(library.libraryDirectory).toBe(path.join(userDataPath, 'media'));
    expect(resolveLocalMediaSourcePath(`cast-media://library/${'a'.repeat(64)}.png`))
      .toBe(path.join(userDataPath, 'media', `${'a'.repeat(64)}.png`));
  });
});

interface FakeAsset {
  id: string;
  src: string;
}

function fakeRepo(assets: FakeAsset[], options: { failOn?: string } = {}) {
  const updates: Array<{ id: string; src: string; preserveMetadata: boolean }> = [];
  const repo = {
    getSnapshot: vi.fn(async () => ({ mediaAssets: assets } as unknown as AppSnapshot)),
    updateMediaAssetSrc: vi.fn(async (id: string, src: string, opts?: { preserveMetadata?: boolean }) => {
      if (options.failOn === id) throw new Error('write failed');
      updates.push({ id, src, preserveMetadata: opts?.preserveMetadata === true });
      return { upserts: { mediaAssets: [{ id, src }] }, deletes: {} } as unknown as SnapshotPatch;
    }),
  };
  return { repo: repo as unknown as MediaLibraryAdoptionRepository, updates, calls: repo };
}

describe('MediaLibraryService adoption of already-imported media', () => {
  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-media-adopt-'));
    userDataPath = path.join(root, 'userData');
    sourceDir = path.join(root, 'elsewhere');
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    setMediaLibraryDirectory(null);
    fs.rmSync(path.dirname(userDataPath), { recursive: true, force: true });
  });

  it('copies external sources into the library and repoints them, keeping their metadata', async () => {
    const library = new MediaLibraryService(userDataPath);
    const { repo, updates } = fakeRepo([
      { id: 'asset-1', src: castMediaSource(writeSource('one.png', 'first')) },
      { id: 'asset-2', src: castMediaSource(writeSource('two.png', 'second')) },
    ]);

    const result = await library.adoptExistingAssets(repo);

    expect(result).toMatchObject({ adopted: 2, unreadable: 0, failed: 0, cancelled: false });
    expect(libraryFiles()).toHaveLength(2);
    expect(updates.map((update) => update.preserveMetadata)).toEqual([true, true]);
    for (const update of updates) {
      expect(isMediaLibraryReference(update.src)).toBe(true);
    }
  });

  it('leaves an asset whose file is already gone untouched, so it still reads as missing', async () => {
    const library = new MediaLibraryService(userDataPath);
    const original = writeSource('gone.png', 'bytes');
    const { repo, calls } = fakeRepo([{ id: 'asset-1', src: castMediaSource(original) }]);
    fs.rmSync(original);

    const result = await library.adoptExistingAssets(repo);

    expect(result).toMatchObject({ adopted: 0, unreadable: 1, failed: 0 });
    expect(calls.updateMediaAssetSrc).not.toHaveBeenCalled();
    expect(libraryFiles()).toEqual([]);
  });

  it('ignores assets that already live in the library and sources with no local file', async () => {
    const library = new MediaLibraryService(userDataPath);
    const alreadyOurs = await library.adopt(castMediaSource(writeSource('logo.png', 'bytes')));
    const { repo, calls } = fakeRepo([
      { id: 'asset-1', src: alreadyOurs },
      { id: 'asset-2', src: 'https://example.com/remote.png' },
      { id: 'asset-3', src: '' },
    ]);

    const result = await library.adoptExistingAssets(repo);

    expect(result.adopted).toBe(0);
    expect(calls.updateMediaAssetSrc).not.toHaveBeenCalled();
  });

  it('reports a patch per adopted asset and clears its status when it finishes', async () => {
    const library = new MediaLibraryService(userDataPath);
    const { repo } = fakeRepo([{ id: 'asset-1', src: castMediaSource(writeSource('one.png', 'first')) }]);
    const progress: MediaLibraryProgress[] = [];

    await library.adoptExistingAssets(repo, { onProgress: (update) => progress.push(update) });

    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatchObject({ copied: 1, total: 1 });
    expect(progress[0]?.patch).toBeDefined();
    expect(progress[0]?.statusText).toContain('1/1');
    expect(progress.at(-1)?.statusText).toBeNull();
  });

  it('stops between assets when cancelled', async () => {
    const library = new MediaLibraryService(userDataPath);
    const { repo, updates } = fakeRepo([
      { id: 'asset-1', src: castMediaSource(writeSource('one.png', 'first')) },
      { id: 'asset-2', src: castMediaSource(writeSource('two.png', 'second')) },
    ]);

    const result = await library.adoptExistingAssets(repo, { isCancelled: () => updates.length > 0 });

    expect(result).toMatchObject({ adopted: 1, cancelled: true });
    expect(updates).toHaveLength(1);
  });

  it('keeps going after one asset fails to be repointed', async () => {
    const library = new MediaLibraryService(userDataPath);
    const { repo, updates } = fakeRepo([
      { id: 'asset-1', src: castMediaSource(writeSource('one.png', 'first')) },
      { id: 'asset-2', src: castMediaSource(writeSource('two.png', 'second')) },
    ], { failOn: 'asset-1' });

    const result = await library.adoptExistingAssets(repo);

    expect(result).toMatchObject({ adopted: 1, failed: 1 });
    expect(updates.map((update) => update.id)).toEqual(['asset-2']);
  });
});

function emptySnapshot(): Record<string, unknown[]> {
  return {
    mediaAssets: [],
    slides: [],
    slideElements: [],
    presentationThemes: [],
    lyricThemes: [],
    talkThemes: [],
    overlayThemes: [],
    overlays: [],
    stages: [],
  };
}

function reclaimRepo(snapshot: Record<string, unknown[]>): MediaLibraryReclaimRepository {
  return { getSnapshot: vi.fn(async () => snapshot as unknown as AppSnapshot) } as unknown as MediaLibraryReclaimRepository;
}

describe('MediaLibraryService reclaim', () => {
  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-media-reclaim-'));
    userDataPath = path.join(root, 'userData');
    sourceDir = path.join(root, 'elsewhere');
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    setMediaLibraryDirectory(null);
    fs.rmSync(path.dirname(userDataPath), { recursive: true, force: true });
  });

  it('removes copies nothing references and keeps the ones still in use', async () => {
    const library = new MediaLibraryService(userDataPath);
    const kept = await library.adopt(castMediaSource(writeSource('kept.png', 'kept-bytes')));
    await library.adopt(castMediaSource(writeSource('orphan.png', 'orphan-bytes-longer')));
    const snapshot = { ...emptySnapshot(), mediaAssets: [{ id: 'asset-1', type: 'image', src: kept }] };

    const result = await library.reclaim(reclaimRepo(snapshot));

    expect(result).toMatchObject({ removedFiles: 1, keptFiles: 1 });
    expect(result.freedBytes).toBe('orphan-bytes-longer'.length);
    expect(libraryFiles()).toHaveLength(1);
  });

  it('keeps a file referenced only by a slide background', async () => {
    const library = new MediaLibraryService(userDataPath);
    const stored = await library.adopt(castMediaSource(writeSource('bg.png', 'bytes')));
    const snapshot = {
      ...emptySnapshot(),
      slides: [{ id: 'slide-1', background: { type: 'image', src: stored } }],
    };

    const result = await library.reclaim(reclaimRepo(snapshot));

    expect(result).toMatchObject({ removedFiles: 0, keptFiles: 1 });
    expect(libraryFiles()).toHaveLength(1);
  });

  it('keeps a file referenced only by an element nested inside a group', async () => {
    const library = new MediaLibraryService(userDataPath);
    const stored = await library.adopt(castMediaSource(writeSource('nested.png', 'bytes')));
    const snapshot = {
      ...emptySnapshot(),
      slideElements: [{
        id: 'group-1',
        type: 'group',
        payload: { children: [{ id: 'child-1', type: 'image', payload: { src: stored } }] },
      }],
    };

    const result = await library.reclaim(reclaimRepo(snapshot));

    expect(result).toMatchObject({ removedFiles: 0, keptFiles: 1 });
  });

  it('keeps a file referenced only by a theme, overlay or stage', async () => {
    const library = new MediaLibraryService(userDataPath);
    const inTheme = await library.adopt(castMediaSource(writeSource('theme.png', 'theme-bytes')));
    const inStage = await library.adopt(castMediaSource(writeSource('stage.png', 'stage-bytes')));
    const snapshot = {
      ...emptySnapshot(),
      presentationThemes: [{ id: 'theme-1', elements: [{ id: 'el-1', type: 'image', payload: { src: inTheme } }] }],
      stages: [{ id: 'stage-1', background: { type: 'video', src: inStage }, elements: [] }],
    };

    const result = await library.reclaim(reclaimRepo(snapshot));

    expect(result).toMatchObject({ removedFiles: 0, keptFiles: 2 });
  });

  it('never removes a file it did not write', async () => {
    const library = new MediaLibraryService(userDataPath);
    await library.adopt(castMediaSource(writeSource('orphan.png', 'bytes')));
    const stranger = path.join(library.libraryDirectory, 'notes.txt');
    fs.writeFileSync(stranger, 'not ours');

    const result = await library.reclaim(reclaimRepo(emptySnapshot()));

    expect(result.removedFiles).toBe(1);
    expect(fs.existsSync(stranger)).toBe(true);
  });

  it('sweeps an abandoned partial copy but leaves a fresh one alone', async () => {
    const library = new MediaLibraryService(userDataPath);
    await library.adopt(castMediaSource(writeSource('seed.png', 'bytes')));
    const stale = path.join(library.libraryDirectory, `${'b'.repeat(64)}.png.1.1.part`);
    const fresh = path.join(library.libraryDirectory, `${'c'.repeat(64)}.png.1.2.part`);
    fs.writeFileSync(stale, 'stale');
    fs.writeFileSync(fresh, 'fresh');
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(stale, longAgo, longAgo);

    await library.reclaim(reclaimRepo(emptySnapshot()));

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });
});
