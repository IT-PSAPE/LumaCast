// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaAsset } from '@lumacast/composition';

const { nativeImageApi, parseFile } = vi.hoisted(() => ({
  nativeImageApi: {
    createThumbnailFromPath: vi.fn(),
    createFromPath: vi.fn(),
    createFromBuffer: vi.fn(),
  },
  parseFile: vi.fn(),
}));

vi.mock('electron', () => ({
  nativeImage: nativeImageApi,
}));

vi.mock('music-metadata', () => ({
  parseFile,
}));

import {
  MAX_FALLBACK_DERIVATIVE_BYTES,
  MediaDerivativeService,
  type MediaDerivativeRepository,
} from './media-derivatives';
import type { EnsureMediaDerivativeResult, SnapshotPatch } from '@lumacast/protocol';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

interface DeferredThumbnail {
  promise: Promise<{ isEmpty: () => boolean; toPNG: () => Buffer }>;
  resolve: () => void;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeDeferredThumbnail(): DeferredThumbnail {
  let resolvePromise!: () => void;
  const promise = new Promise<{ isEmpty: () => boolean; toPNG: () => Buffer }>((resolve) => {
    resolvePromise = () => resolve({
      isEmpty: () => false,
      toPNG: () => Buffer.from('png-bytes'),
    });
  });
  return { promise, resolve: resolvePromise };
}

async function flushNodeTasks(turns = 1): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function asset(id: string, overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    name: `Asset ${id}`,
    type: 'video',
    src: path.join(os.tmpdir(), `${id}.mp4`),
    width: null,
    height: null,
    duration: null,
    codec: null,
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function pngHeader(width: number, height: number): Uint8Array {
  const buffer = Buffer.alloc(24);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return new Uint8Array(buffer);
}

const SAFE_FALLBACK_PNG = pngHeader(640, 360);

function createRepoStub(assets: MediaAsset[]): MediaDerivativeRepository {
  const assetMap = new Map(assets.map((entry) => [entry.id, entry]));
  return {
    getMediaAsset: vi.fn(async (id: string) => assetMap.get(id) ?? null),
    updateMediaAssetMetadata: vi.fn(async (_id: string, _src: string, metadata: Partial<MediaAsset>) => {
      if (!metadata.width && !metadata.height && !metadata.duration && !metadata.codec) return null;
      return {
        version: 1,
        deletes: {},
        upserts: {
          mediaAssets: [{
            ...assetMap.get(_id)!,
            ...metadata,
          }],
        },
      } satisfies SnapshotPatch;
    }),
    buildMediaAssetPatch: vi.fn(async (id: string) => ({
      version: 1,
      deletes: {},
      upserts: { mediaAssets: [assetMap.get(id)!] },
    })),
  };
}

describe('MediaDerivativeService', () => {
  let tempRoot: string;

  beforeEach(() => {
    setPlatform('darwin');
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-media-derivatives-'));
    nativeImageApi.createThumbnailFromPath.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('default-png'),
    });
    nativeImageApi.createFromPath.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 1280, height: 720 }),
    });
    parseFile.mockResolvedValue({
      format: {
        duration: 12.5,
        codec: 'h264',
        trackInfo: [{ codecName: 'h264', video: { pixelWidth: 1280, pixelHeight: 720 } }],
      },
      common: {},
    });
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('deduplicates concurrent ensure calls for the same asset id', async () => {
    const sourcePath = path.join(tempRoot, 'same.mp4');
    fs.writeFileSync(sourcePath, 'video');
    const sameAsset = { ...asset('same'), src: sourcePath };
    const repo = createRepoStub([sameAsset]);
    const deferred = makeDeferredThumbnail();
    nativeImageApi.createThumbnailFromPath.mockReturnValue(deferred.promise);

    const service = new MediaDerivativeService(repo, tempRoot);
    const first = service.ensure('same');
    const second = service.ensure('same');
    deferred.resolve();

    const [left, right] = await Promise.all([first, second]);

    expect(left.status).toBe('ready');
    expect(right.status).toBe('ready');
    expect(nativeImageApi.createThumbnailFromPath).toHaveBeenCalledTimes(1);
  });

  it('admits duplicate ensure calls before source stat work, so repeated floods do not fan out', async () => {
    const sourcePath = path.join(tempRoot, 'preadmit.mp4');
    fs.writeFileSync(sourcePath, 'video');
    let resolveLookup!: (value: MediaAsset | null) => void;
    const lookup = new Promise<MediaAsset | null>((resolve) => { resolveLookup = resolve; });
    const repo = createRepoStub([asset('preadmit', { src: sourcePath })]);
    vi.mocked(repo.getMediaAsset).mockReturnValue(lookup as never);
    nativeImageApi.createThumbnailFromPath.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('preadmit-png'),
    });
    const service = new MediaDerivativeService(repo, tempRoot);

    const first = service.ensure('preadmit');
    const second = service.ensure('preadmit');
    await flushNodeTasks(2);

    expect(repo.getMediaAsset).toHaveBeenCalledTimes(1);
    resolveLookup(asset('preadmit', { src: sourcePath }));

    await Promise.all([first, second]);
    expect(nativeImageApi.createThumbnailFromPath).toHaveBeenCalledTimes(1);
  });

  it('awaits the async persistence lookup before deriving media source state', async () => {
    const sourcePath = path.join(tempRoot, 'async.mp4');
    fs.writeFileSync(sourcePath, 'video');
    const currentAsset = { ...asset('async'), src: sourcePath };
    let resolveLookup!: (value: MediaAsset | null) => void;
    const lookup = new Promise<MediaAsset | null>((resolve) => { resolveLookup = resolve; });
    const repo = createRepoStub([currentAsset]);
    vi.mocked(repo.getMediaAsset).mockReturnValue(lookup);
    nativeImageApi.createThumbnailFromPath.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('async-png'),
    });
    const service = new MediaDerivativeService(repo, tempRoot);

    const pending = service.ensure('async');
    await flushNodeTasks(2);
    expect(nativeImageApi.createThumbnailFromPath).not.toHaveBeenCalled();

    resolveLookup(currentAsset);
    await expect(pending).resolves.toEqual(expect.objectContaining({ assetId: 'async', status: 'ready' }));
    expect(nativeImageApi.createThumbnailFromPath).toHaveBeenCalledTimes(1);
  });

  it('never exceeds three concurrent derivative generation tasks', async () => {
    const assets = Array.from({ length: 5 }, (_, index) => {
      const filePath = path.join(tempRoot, `asset-${index}.mp4`);
      fs.writeFileSync(filePath, 'video');
      return { ...asset(`asset-${index}`), src: filePath };
    });
    const repo = createRepoStub(assets);
    let active = 0;
    let maxActive = 0;
    const deferreds = assets.map(() => makeDeferredThumbnail());
    const pendingDeferreds = [...deferreds];
    nativeImageApi.createThumbnailFromPath.mockImplementation((_filePath: string) => {
      const deferred = pendingDeferreds.shift()!;
      active += 1;
      maxActive = Math.max(maxActive, active);
      return deferred.promise.finally(() => {
        active -= 1;
      });
    });

    const service = new MediaDerivativeService(repo, tempRoot);
    const pending = assets.map((entry) => service.ensure(entry.id));
    await vi.waitFor(() => {
      expect(maxActive).toBeGreaterThan(0);
    });
    expect(maxActive).toBeLessThanOrEqual(3);
    deferreds.splice(0).forEach((deferred) => deferred.resolve());
    await Promise.all(pending);
    expect(nativeImageApi.createThumbnailFromPath).toHaveBeenCalledTimes(5);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('applies foreground backpressure once the pending asset cap is reached', async () => {
    const assets = Array.from({ length: 30 }, (_, index) => {
      const filePath = path.join(tempRoot, `cap-${index}.mp4`);
      fs.writeFileSync(filePath, 'video');
      return asset(`cap-${index}`, { src: filePath });
    });
    const repo = createRepoStub(assets);
    const deferreds = Array.from({ length: assets.length }, () => makeDeferredThumbnail());
    const pendingDeferreds = [...deferreds];
    nativeImageApi.createThumbnailFromPath.mockImplementation(() => pendingDeferreds.shift()!.promise);
    const service = new MediaDerivativeService(repo, tempRoot);

    const pendingResults = assets.map((entry) => service.ensure(entry.id));
    await flushNodeTasks(6);
    const results = await Promise.all(pendingResults.map(async (result, index) => {
      if (index < 24) deferreds[index]?.resolve();
      return result;
    }));

    const failed = results.filter((result) => result.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(nativeImageApi.createThumbnailFromPath.mock.calls.length).toBeLessThanOrEqual(24);
  });

  it('rejects oversized fallback uploads before decoding them', async () => {
    const sourcePath = path.join(tempRoot, 'same.mp4');
    fs.writeFileSync(sourcePath, 'video');
    const repo = createRepoStub([{ ...asset('same'), src: sourcePath }]);
    const service = new MediaDerivativeService(repo, tempRoot);
    setPlatform('linux');
    const ensure = await service.ensure('same');

    await expect(
      service.uploadFallback(
        'same',
        ensure.generationToken ?? 'missing-token',
        ensure.sourceFingerprint ?? 'missing-fingerprint',
        new Uint8Array(MAX_FALLBACK_DERIVATIVE_BYTES + 1),
      ),
    )
      .rejects.toThrow(/exceeds/);
    expect(nativeImageApi.createFromBuffer).not.toHaveBeenCalled();
  });

  it('rejects malformed fallback images before native decode', async () => {
    setPlatform('linux');
    const sourcePath = path.join(tempRoot, 'malformed.mp4');
    fs.writeFileSync(sourcePath, 'video');
    const repo = createRepoStub([{ ...asset('malformed'), src: sourcePath }]);
    const service = new MediaDerivativeService(repo, tempRoot);
    const ensure = await service.ensure('malformed');

    await expect(
      service.uploadFallback(
        'malformed',
        ensure.generationToken ?? 'missing-token',
        ensure.sourceFingerprint ?? 'missing-fingerprint',
        new Uint8Array([0x00, 0x01, 0x02, 0x03]),
      ),
    ).rejects.toThrow(/supported PNG, JPEG, GIF, or WebP/i);
    expect(nativeImageApi.createFromBuffer).not.toHaveBeenCalled();
  });

  it('rejects oversized encoded fallback dimensions before native decode', async () => {
    setPlatform('linux');
    const sourcePath = path.join(tempRoot, 'bomb.mp4');
    fs.writeFileSync(sourcePath, 'video');
    const repo = createRepoStub([{ ...asset('bomb'), src: sourcePath }]);
    const service = new MediaDerivativeService(repo, tempRoot);
    const ensure = await service.ensure('bomb');

    await expect(
      service.uploadFallback(
        'bomb',
        ensure.generationToken ?? 'missing-token',
        ensure.sourceFingerprint ?? 'missing-fingerprint',
        pngHeader(20_000, 20_000),
      ),
    ).rejects.toThrow(/exceeds/i);
    expect(nativeImageApi.createFromBuffer).not.toHaveBeenCalled();
  });

  it('rejects oversized embedded audio artwork before the thumbnail decode path', async () => {
    const sourcePath = path.join(tempRoot, 'audio.mp3');
    fs.writeFileSync(sourcePath, 'audio');
    const audioAsset = asset('audio-art', { type: 'audio', src: sourcePath });
    const repo = createRepoStub([audioAsset]);
    const hugePng = Buffer.alloc(24);
    hugePng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    hugePng.writeUInt32BE(20_000, 16);
    hugePng.writeUInt32BE(20_000, 20);
    parseFile.mockResolvedValue({
      format: {
        duration: 12.5,
        codec: 'mp3',
        trackInfo: [],
      },
      common: {
        picture: [{ data: hugePng }],
      },
    });
    const service = new MediaDerivativeService(repo, tempRoot);

    await service.ensure('audio-art');

    expect(nativeImageApi.createFromBuffer).not.toHaveBeenCalled();
  });

  it('returns a patch even when a valid derivative already exists and metadata is unchanged', async () => {
    const sourcePath = path.join(tempRoot, 'ready-again.mp4');
    fs.writeFileSync(sourcePath, 'video');
    const repo = createRepoStub([asset('ready-again', { src: sourcePath })]);
    nativeImageApi.createThumbnailFromPath.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('ready-again-png'),
    });
    const service = new MediaDerivativeService(repo, tempRoot);

    await service.ensure('ready-again');
    vi.mocked(repo.updateMediaAssetMetadata).mockResolvedValueOnce(null);
    vi.mocked(repo.buildMediaAssetPatch).mockClear();

    const result = await service.ensure('ready-again');
    const attached = service.attachToResult(result) as EnsureMediaDerivativeResult;

    expect(result.status).toBe('ready');
    expect(result.patch).toBeDefined();
    expect(repo.buildMediaAssetPatch).toHaveBeenCalledWith('ready-again');
    expect(attached.patch?.upserts.mediaAssets?.[0]?.thumbnailSrc).toContain('/thumbs/');
  });

  it('does not associate a completed derivative with a replaced source', async () => {
    const firstSource = path.join(tempRoot, 'replace-a.mp4');
    const secondSource = path.join(tempRoot, 'replace-b.mp4');
    fs.writeFileSync(firstSource, 'video-a');
    fs.writeFileSync(secondSource, 'video-b');

    const assetMap = new Map<string, MediaAsset>([['replace', { ...asset('replace'), src: firstSource }]]);
    const repo = {
      getMediaAsset: vi.fn(async (id: string) => assetMap.get(id) ?? null),
      updateMediaAssetMetadata: vi.fn(async (_id: string, src: string, metadata: Partial<MediaAsset>) => {
        const current = assetMap.get(_id);
        if (!current || current.src !== src) return null;
        assetMap.set(_id, { ...current, ...metadata });
        return {
          version: 1,
          deletes: {},
          upserts: { mediaAssets: [{ ...assetMap.get(_id)! }] },
        } satisfies SnapshotPatch;
      }),
      buildMediaAssetPatch: vi.fn(async (id: string) => ({
        version: 1,
        deletes: {},
        upserts: { mediaAssets: [assetMap.get(id)!] },
      })),
    } satisfies MediaDerivativeRepository;

    const deferred = makeDeferredThumbnail();
    nativeImageApi.createThumbnailFromPath.mockReturnValueOnce(deferred.promise).mockResolvedValueOnce({
      isEmpty: () => false,
      toPNG: () => Buffer.from('png-b'),
    });

    const service = new MediaDerivativeService(repo, tempRoot);
    const firstEnsure = service.ensure('replace');
    await flushNodeTasks(3);
    assetMap.set('replace', { ...assetMap.get('replace')!, src: secondSource, updatedAt: '2026-01-02T00:00:00.000Z' });
    const secondEnsure = service.ensure('replace');
    deferred.resolve();

    await firstEnsure;
    const secondResult = await secondEnsure;
    const attachedCurrent = service.attachToResult({
      mediaAssets: [assetMap.get('replace')!],
      slides: [],
      slideElements: [],
    }) as { mediaAssets: MediaAsset[] };
    const attachedStale = service.attachToResult({
      mediaAssets: [{ ...assetMap.get('replace')!, src: firstSource }],
      slides: [],
      slideElements: [],
    }) as { mediaAssets: MediaAsset[] };

    expect(secondResult.status).toBe('ready');
    expect(attachedCurrent.mediaAssets[0]?.thumbnailSrc).toContain('/thumbs/');
    expect(attachedStale.mediaAssets[0]?.thumbnailSrc ?? null).toBeNull();
  });

  it('retries when an existing-thumbnail check races with source replacement', async () => {
    const firstSource = path.join(tempRoot, 'existing-a.mp4');
    const secondSource = path.join(tempRoot, 'existing-b.mp4');
    fs.writeFileSync(firstSource, 'video-a');
    fs.writeFileSync(secondSource, 'video-b');
    const assetMap = new Map<string, MediaAsset>([[
      'existing-race',
      { ...asset('existing-race'), src: firstSource },
    ]]);
    const repo = {
      getMediaAsset: vi.fn(async (id: string) => assetMap.get(id) ?? null),
      updateMediaAssetMetadata: vi.fn(async () => null),
      buildMediaAssetPatch: vi.fn(async (id: string) => ({
        version: 1,
        deletes: {},
        upserts: { mediaAssets: [assetMap.get(id)!] },
      } satisfies SnapshotPatch)),
    } satisfies MediaDerivativeRepository;
    const service = new MediaDerivativeService(repo, tempRoot);
    let resolveExistingCheck!: (value: string | null) => void;
    const existingCheck = new Promise<string | null>((resolve) => { resolveExistingCheck = resolve; });
    const validateSpy = vi.spyOn(
      service as unknown as { validateCurrentThumbnail: (descriptor: unknown) => Promise<string | null> },
      'validateCurrentThumbnail',
    )
      .mockReturnValueOnce(existingCheck)
      .mockResolvedValue(null);
    nativeImageApi.createThumbnailFromPath.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('replacement-thumbnail'),
    });

    const pending = service.ensure('existing-race');
    await vi.waitFor(() => expect(validateSpy).toHaveBeenCalledTimes(1));
    assetMap.set('existing-race', {
      ...assetMap.get('existing-race')!,
      src: secondSource,
      updatedAt: '2026-01-04T00:00:00.000Z',
    });
    resolveExistingCheck('/tmp/existing-thumbnail.png');

    await expect(pending).resolves.toEqual(expect.objectContaining({ status: 'ready' }));
    expect(nativeImageApi.createThumbnailFromPath).toHaveBeenCalledWith(
      secondSource,
      expect.any(Object),
    );
  });

  it('rejects fallback uploads minted for an older source fingerprint', async () => {
    setPlatform('linux');
    const firstSource = path.join(tempRoot, 'linux-a.mp4');
    const secondSource = path.join(tempRoot, 'linux-b.mp4');
    fs.writeFileSync(firstSource, 'video-a');
    fs.writeFileSync(secondSource, 'video-b');
    const assetMap = new Map<string, MediaAsset>([['replace', { ...asset('replace'), src: firstSource }]]);
    const repo = createRepoStub([assetMap.get('replace')!]);
    vi.mocked(repo.getMediaAsset).mockImplementation(async (id: string) => assetMap.get(id) ?? null);
    const service = new MediaDerivativeService(repo, tempRoot);

    const first = await service.ensure('replace');
    assetMap.set('replace', { ...assetMap.get('replace')!, src: secondSource, updatedAt: '2026-01-03T00:00:00.000Z' });

    expect(first.status).toBe('needs-upload');
    await expect(
      service.uploadFallback(
        'replace',
        first.generationToken ?? 'missing-token',
        first.sourceFingerprint ?? 'missing-fingerprint',
        SAFE_FALLBACK_PNG,
      ),
    ).rejects.toThrow(/stale|fingerprint|token/i);
  });

  it('counts needs-upload batch work as failed progress instead of completed success', async () => {
    setPlatform('linux');
    const sourcePath = path.join(tempRoot, 'linux-progress.mp4');
    fs.writeFileSync(sourcePath, 'video');
    const repo = createRepoStub([asset('linux-progress', { src: sourcePath })]);
    const service = new MediaDerivativeService(repo, tempRoot);
    const progress: Array<{ completed: number; failed: number; total: number; statusText: string | null }> = [];
    service.onProgress((next) => {
      progress.push({
        completed: next.completed,
        failed: next.failed,
        total: next.total,
        statusText: next.statusText,
      });
    });

    service.scheduleBatch(['linux-progress']);
    await vi.waitFor(() => {
      expect(progress.at(-1)).toEqual(expect.objectContaining({
        completed: 0,
        failed: 1,
        total: 1,
        statusText: null,
      }));
    });
  });

  it('processes every background batch even after more than eight batches are queued', async () => {
    const assets = Array.from({ length: 10 }, (_, index) => {
      const filePath = path.join(tempRoot, `batch-${index}.mp4`);
      fs.writeFileSync(filePath, 'video');
      return asset(`batch-${index}`, { src: filePath });
    });
    const repo = createRepoStub(assets);
    nativeImageApi.createThumbnailFromPath.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('batch-png'),
    });
    const service = new MediaDerivativeService(repo, tempRoot);

    for (const entry of assets) {
      service.scheduleBatch([entry.id]);
    }
    await vi.waitFor(() => {
      expect(nativeImageApi.createThumbnailFromPath).toHaveBeenCalledTimes(10);
    });
  });

  it('dedupes duplicate ids within one scheduled batch so progress totals still complete', async () => {
    const sourcePath = path.join(tempRoot, 'dup-batch.mp4');
    fs.writeFileSync(sourcePath, 'video');
    const repo = createRepoStub([asset('dup-batch', { src: sourcePath })]);
    nativeImageApi.createThumbnailFromPath.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('dup-batch-png'),
    });
    const service = new MediaDerivativeService(repo, tempRoot);
    const progress: Array<{ completed: number; failed: number; total: number; statusText: string | null }> = [];
    service.onProgress((next) => {
      progress.push({
        completed: next.completed,
        failed: next.failed,
        total: next.total,
        statusText: next.statusText,
      });
    });

    service.scheduleBatch(['dup-batch', 'dup-batch']);

    await vi.waitFor(() => {
      expect(progress.at(-1)).toEqual(expect.objectContaining({
        completed: 1,
        failed: 0,
        total: 1,
        statusText: null,
      }));
    });
    expect(nativeImageApi.createThumbnailFromPath).toHaveBeenCalledTimes(1);
  });

  it('keeps visible ensure admission available even when background jobs are already admitted', async () => {
    const backgroundAssets = Array.from({ length: 24 }, (_, index) => {
      const filePath = path.join(tempRoot, `background-${index}.mp4`);
      fs.writeFileSync(filePath, 'video');
      return asset(`background-${index}`, { src: filePath });
    });
    const visiblePath = path.join(tempRoot, 'visible.mp4');
    fs.writeFileSync(visiblePath, 'video');
    const visibleAsset = asset('visible', { src: visiblePath });
    const repo = createRepoStub([...backgroundAssets, visibleAsset]);
    const deferreds = Array.from({ length: backgroundAssets.length + 1 }, () => makeDeferredThumbnail());
    const pendingDeferreds = [...deferreds];
    const started: string[] = [];
    nativeImageApi.createThumbnailFromPath.mockImplementation((filePath: string) => {
      started.push(path.basename(filePath));
      return pendingDeferreds.shift()!.promise;
    });
    const service = new MediaDerivativeService(repo, tempRoot);

    service.scheduleBatch(backgroundAssets.map((entry) => entry.id));
    await flushNodeTasks(6);

    const visiblePromise = service.ensure('visible');
    let visibleSettled = false;
    void visiblePromise.then(() => {
      visibleSettled = true;
    });
    await flushNodeTasks(2);

    expect(visibleSettled).toBe(false);
    deferreds[0]?.resolve();
    await vi.waitFor(() => {
      expect(started).toContain('visible.mp4');
    });
    deferreds.forEach((deferred) => deferred.resolve());
    await expect(visiblePromise).resolves.toEqual(expect.objectContaining({ status: 'ready' }));
  });

  it('routes fallback uploads through the bounded derivative runner', async () => {
    setPlatform('linux');
    const assets = Array.from({ length: 5 }, (_, index) => {
      const filePath = path.join(tempRoot, `upload-${index}.mp4`);
      fs.writeFileSync(filePath, 'video');
      return asset(`upload-${index}`, { src: filePath });
    });
    const repo = createRepoStub(assets);
    const patchDeferreds = assets.map(() => createDeferred<SnapshotPatch>());
    let patchIndex = 0;
    let active = 0;
    let maxActive = 0;
    nativeImageApi.createFromBuffer.mockImplementation(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return {
        isEmpty: () => false,
        getSize: () => ({ width: 1920, height: 1080 }),
        resize: () => ({
          toPNG: () => Buffer.from('fallback-png'),
        }),
      };
    });
    vi.mocked(repo.buildMediaAssetPatch).mockImplementation(async () => {
      const deferred = patchDeferreds[patchIndex++]!;
      return deferred.promise.finally(() => {
        active = Math.max(0, active - 1);
      });
    });

    const service = new MediaDerivativeService(repo, tempRoot);
    const ensures = await Promise.all(assets.map((entry) => service.ensure(entry.id)));
    const uploads = ensures.map((result, index) => service.uploadFallback(
      assets[index]!.id,
      result.generationToken ?? `missing-token-${index}`,
      result.sourceFingerprint ?? `missing-fingerprint-${index}`,
      SAFE_FALLBACK_PNG,
    ));

    await flushNodeTasks(6);
    expect(maxActive).toBeGreaterThan(0);
    expect(maxActive).toBeLessThanOrEqual(3);

    for (let index = 0; index < assets.length; index += 1) {
      patchDeferreds[index]!.resolve({
        version: 1,
        deletes: {},
        upserts: { mediaAssets: [assets[index]!] },
      });
    }

    await expect(Promise.all(uploads)).resolves.toHaveLength(5);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it('deduplicates concurrent fallback uploads for the same token and rejects replay after single use', async () => {
    setPlatform('linux');
    const sourcePath = path.join(tempRoot, 'token-flood.mp4');
    fs.writeFileSync(sourcePath, 'video');
    const entry = asset('token-flood', { src: sourcePath });
    const repo = createRepoStub([entry]);
    const patchDeferred = createDeferred<SnapshotPatch>();
    vi.mocked(repo.buildMediaAssetPatch).mockReturnValue(patchDeferred.promise);
    let decodeCalls = 0;
    nativeImageApi.createFromBuffer.mockImplementation(() => {
      decodeCalls += 1;
      return {
        isEmpty: () => false,
        getSize: () => ({ width: 1920, height: 1080 }),
        resize: () => ({
          toPNG: () => Buffer.from('fallback-png'),
        }),
      };
    });

    const service = new MediaDerivativeService(repo, tempRoot);
    const ensured = await service.ensure('token-flood');
    expect(ensured.status).toBe('needs-upload');

    const uploads = Array.from({ length: 12 }, () => service.uploadFallback(
      'token-flood',
      ensured.generationToken ?? 'missing-token',
      ensured.sourceFingerprint ?? 'missing-fingerprint',
      SAFE_FALLBACK_PNG,
    ));
    await flushNodeTasks(6);

    expect(decodeCalls).toBe(1);

    patchDeferred.resolve({
      version: 1,
      deletes: {},
      upserts: { mediaAssets: [entry] },
    });

    const results = await Promise.all(uploads);
    expect(results.every((result) => result.status === 'ready')).toBe(true);
    expect(repo.buildMediaAssetPatch).toHaveBeenCalledTimes(1);
    await expect(
      service.uploadFallback(
        'token-flood',
        ensured.generationToken ?? 'missing-token',
        ensured.sourceFingerprint ?? 'missing-fingerprint',
        SAFE_FALLBACK_PNG,
      ),
    ).rejects.toThrow(/stale|token/i);
  });

  it('parses JPEG dimensions from the SOF segment without swapping offsets', async () => {
    const sourcePath = path.join(tempRoot, 'header.jpg');
    const jpeg = Buffer.from([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11,
      0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xd9,
    ]);
    fs.writeFileSync(sourcePath, jpeg);
    const imageAsset = asset('header-jpeg', { type: 'image', src: sourcePath });
    const repo = createRepoStub([imageAsset]);
    nativeImageApi.createThumbnailFromPath.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('jpeg-png'),
    });
    const service = new MediaDerivativeService(repo, tempRoot);

    await service.ensure('header-jpeg');

    expect(repo.updateMediaAssetMetadata).toHaveBeenCalledWith(
      'header-jpeg',
      sourcePath,
      expect.objectContaining({ width: 1920, height: 1080 }),
    );
  });

  it('masks VP8 dimensions to 14 bits before reporting metadata', async () => {
    const sourcePath = path.join(tempRoot, 'header.webp');
    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0, 'ascii');
    webp.write('WEBP', 8, 'ascii');
    webp.write('VP8 ', 12, 'ascii');
    webp.writeUInt16LE(0x4280, 26);
    webp.writeUInt16LE(0x4168, 28);
    fs.writeFileSync(sourcePath, webp);
    const imageAsset = asset('header-webp', { type: 'image', src: sourcePath });
    const repo = createRepoStub([imageAsset]);
    nativeImageApi.createThumbnailFromPath.mockResolvedValue({
      isEmpty: () => false,
      toPNG: () => Buffer.from('webp-png'),
    });
    const service = new MediaDerivativeService(repo, tempRoot);

    await service.ensure('header-webp');

    expect(repo.updateMediaAssetMetadata).toHaveBeenCalledWith(
      'header-webp',
      sourcePath,
      expect.objectContaining({ width: 640, height: 360 }),
    );
  });

  it('attaches thumbnail descriptors without source stat or decode work', () => {
    const sourcePath = path.join(tempRoot, 'descriptor.mp4');
    fs.writeFileSync(sourcePath, 'video');
    const thumbsDir = path.join(tempRoot, 'thumbs');
    const manifestPath = path.join(thumbsDir, 'manifest.json');
    fs.mkdirSync(thumbsDir, { recursive: true });
    const fileName = '0123456789abcdef0123456789abcdef01234567.png';
    const sourceFingerprint = path.parse(fileName).name;
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        entries: {
          'descriptor:thumbnail': {
            assetId: 'descriptor',
            use: 'thumbnail',
            source: sourcePath,
            sourceSize: 5,
            sourceMtimeMs: 1,
            fingerprint: sourceFingerprint,
            sourceFingerprint,
            fileName,
          },
        },
      }),
      'utf8',
    );
    const repo = createRepoStub([{ ...asset('descriptor'), src: sourcePath }]);
    const service = new MediaDerivativeService(repo, tempRoot);

    const statSpy = vi.spyOn(fs, 'statSync');
    const decodeSpy = nativeImageApi.createFromPath;
    const attached = service.attachToResult({
      mediaAssets: [{ ...asset('descriptor'), src: sourcePath }],
      slides: [],
      slideElements: [],
    }) as { mediaAssets: MediaAsset[] };

    expect(attached.mediaAssets[0]?.thumbnailSrc).toContain(fileName);
    expect(statSpy).not.toHaveBeenCalled();
    expect(decodeSpy).not.toHaveBeenCalled();
  });
});
