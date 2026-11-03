// @vitest-environment node
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaAssetStore } from '../../../../apps/stream/main/media-assets';
import { PresentationImporter, runPresentationWorker, type PresentationImporterDependencies } from '../../../../apps/stream/main/presentation-import';
import type { PresentationRenderRequest } from '../../../../apps/stream/main/presentation-render';

vi.mock('node:worker_threads', () => ({ Worker: vi.fn() }));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(Worker).mockReset();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lumastream-presentation-import-test-'));
  temporaryDirectories.push(root);
  const sourcePath = path.join(root, 'Sunday.PPTX');
  await writeFile(sourcePath, 'selected presentation');
  const window = Object.assign(new EventEmitter(), { isDestroyed: vi.fn(() => false) }) as unknown as BrowserWindow;
  const dialogs = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: [sourcePath] }) };
  const media = new MediaAssetStore(path.join(root, 'data'), () => window, dialogs);
  let outputDirectory = '';
  const runWorker = vi.fn(async (_workerPath: string, request: PresentationRenderRequest) => {
    outputDirectory = request.outputDirectory;
    return Promise.all([1, 2, 3].map(async (number) => {
      const filePath = path.join(request.outputDirectory, `slide-${number}.png`);
      await writeFile(filePath, `page ${number}`);
      return { path: filePath, name: `Slide ${number}` };
    }));
  });
  const importer = (overrides: PresentationImporterDependencies = {}) => new PresentationImporter(media, () => window, '/worker/presentation-worker.js', { dialogs, runWorker, ...overrides });
  return { root, sourcePath, window, dialogs, media, runWorker, importer, outputDirectory: () => outputDirectory, mediaDirectory: path.join(root, 'data/media') };
}

describe('Stream presentation import', () => {
  it('chooses a PPTX or PDF and atomically imports every rendered page in order', async () => {
    const context = await setup();
    const presentation = await context.importer({ fontDirectory: '/resources/presentation-fonts' }).chooseAndImport();
    expect(context.dialogs.showOpenDialog).toHaveBeenCalledWith(context.window, expect.objectContaining({
      properties: ['openFile'], filters: [{ name: 'Presentations', extensions: ['pptx', 'pdf'] }],
    }));
    expect(presentation?.name).toBe('Sunday');
    expect(presentation?.slides.map(({ name }) => name)).toEqual(['Slide 1', 'Slide 2', 'Slide 3']);
    expect(new Set(presentation?.slides.map(({ assetId }) => assetId)).size).toBe(3);
    expect(await Promise.all(presentation!.slides.map(({ assetId }) => readFile(path.join(context.mediaDirectory, `${assetId}.png`), 'utf8')))).toEqual(['page 1', 'page 2', 'page 3']);
    expect(context.runWorker).toHaveBeenCalledWith('/worker/presentation-worker.js', expect.objectContaining({ fontDirectory: '/resources/presentation-fonts' }), expect.objectContaining({ timeoutMs: 60_000 }));
    await expect(readdir(context.outputDirectory())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(context.window.listenerCount('closed')).toBe(0);
  });

  it('returns null without conversion or media writes when the picker is canceled', async () => {
    const context = await setup();
    context.dialogs.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(context.importer().chooseAndImport()).resolves.toBeNull();
    expect(context.runWorker).not.toHaveBeenCalled();
    await expect(readdir(context.mediaDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back earlier managed pages when importing a later page fails', async () => {
    const context = await setup();
    const realImport = context.media.importCollectionBundleAsset.bind(context.media);
    vi.spyOn(context.media, 'importCollectionBundleAsset').mockImplementationOnce(realImport).mockRejectedValueOnce(new Error('Disk is full'));
    await expect(context.importer().chooseAndImport()).rejects.toThrow('Disk is full');
    expect(await readdir(context.mediaDirectory)).toEqual([]);
    await expect(readdir(context.outputDirectory())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes temporary output after a converter error or timeout', async () => {
    const context = await setup();
    let temporaryDirectory = '';
    const runWorker = vi.fn(async (_workerPath: string, request: PresentationRenderRequest) => {
      temporaryDirectory = request.outputDirectory;
      await writeFile(path.join(temporaryDirectory, 'partial.png'), 'partial');
      throw new Error('Presentation import took too long.');
    });
    await expect(context.importer({ runWorker }).chooseAndImport()).rejects.toThrow('took too long');
    await expect(readdir(temporaryDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readdir(context.mediaDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects worker paths outside its temporary directory without deleting the original', async () => {
    const context = await setup();
    const outside = path.join(context.root, 'original.png');
    await writeFile(outside, 'original');
    const runWorker = vi.fn().mockResolvedValue([{ path: outside, name: 'Slide 1' }]);
    await expect(context.importer({ runWorker }).chooseAndImport()).rejects.toThrow('invalid slide');
    expect(await readFile(outside, 'utf8')).toBe('original');
  });

  it('rejects a worker output symlink', async () => {
    const context = await setup();
    const outside = path.join(context.root, 'original.png');
    await writeFile(outside, 'original');
    const runWorker = vi.fn(async (_workerPath: string, request: PresentationRenderRequest) => {
      const filePath = path.join(request.outputDirectory, 'page.png');
      await symlink(outside, filePath);
      return [{ path: filePath, name: 'Slide 1' }];
    });
    await expect(context.importer({ runWorker }).chooseAndImport()).rejects.toThrow('invalid slide');
    expect(await readFile(outside, 'utf8')).toBe('original');
  });

  it('rolls back managed pages if the window closes during import', async () => {
    const context = await setup();
    const realImport = context.media.importCollectionBundleAsset.bind(context.media);
    vi.spyOn(context.media, 'importCollectionBundleAsset').mockImplementationOnce(async (...args) => {
      const id = await realImport(...args);
      context.window.emit('closed');
      return id;
    });
    await expect(context.importer().chooseAndImport()).rejects.toThrow('canceled');
    expect(await readdir(context.mediaDirectory)).toEqual([]);
    await expect(readdir(context.outputDirectory())).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function fakeWorker() {
  const worker = Object.assign(new EventEmitter(), { terminate: vi.fn().mockResolvedValue(1) });
  vi.mocked(Worker).mockImplementation(function () { return worker as unknown as Worker; });
  return worker;
}

describe('presentation worker lifecycle', () => {
  const request = { sourcePath: '/selected.pptx', outputDirectory: '/temporary-output' };

  it('caps worker memory and terminates before returning its ordered pages', async () => {
    const worker = fakeWorker();
    const pending = runPresentationWorker('/presentation-worker.js', request, { timeoutMs: 1000 });
    const slides = [{ path: '/temporary-output/slide-001.png', name: 'Slide 1' }];
    worker.emit('message', { ok: true, slides });
    await expect(pending).resolves.toEqual(slides);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(Worker).toHaveBeenCalledWith('/presentation-worker.js', expect.objectContaining({ workerData: request, resourceLimits: { maxOldGenerationSizeMb: 512 } }));
  });

  it('terminates a stalled worker when its timeout expires', async () => {
    const worker = fakeWorker();
    await expect(runPresentationWorker('/presentation-worker.js', request, { timeoutMs: 5 })).rejects.toThrow('took too long');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.listenerCount('message')).toBe(0);
  });

  it('terminates on cancellation and rejects before cleanup can begin', async () => {
    const worker = fakeWorker();
    const abort = new AbortController();
    const pending = runPresentationWorker('/presentation-worker.js', request, { timeoutMs: 1000, signal: abort.signal });
    abort.abort();
    await expect(pending).rejects.toThrow('canceled');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects premature worker exit rather than hanging until timeout', async () => {
    const worker = fakeWorker();
    const pending = runPresentationWorker('/presentation-worker.js', request, { timeoutMs: 1000 });
    worker.emit('exit', 1);
    await expect(pending).rejects.toThrow('stopped before completing');
  });
});
