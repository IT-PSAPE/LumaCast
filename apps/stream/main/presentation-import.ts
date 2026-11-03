import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { dialog, type BrowserWindow } from 'electron';
import type { ImportedPresentation, SlideshowImage } from '../shared/desktop-api';
import type { MediaAssetStore } from './media-assets';
import { MAX_PRESENTATION_SLIDES, validatePresentationFile, type PresentationRenderRequest, type RenderedPresentationSlide } from './presentation-render';

const MAX_IMPORT_TIME_MS = 60_000;
const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const CANCELED_MESSAGE = 'Presentation import was canceled.';
const TIMED_OUT_MESSAGE = 'Presentation import took too long. Try a smaller or simplified presentation.';

export interface PresentationWorkerOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Resolves only after the worker has stopped, so temporary-file cleanup cannot race conversion. */
export function runPresentationWorker(workerPath: string, request: PresentationRenderRequest, options: PresentationWorkerOptions): Promise<RenderedPresentationSlide[]> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error(CANCELED_MESSAGE)); return; }
    const worker = new Worker(workerPath, {
      workerData: request,
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    let settled = false;
    const finish = (error: Error | null, slides?: RenderedPresentationSlide[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', canceled);
      void worker.terminate().catch(() => undefined).then(() => {
        worker.removeAllListeners();
        if (error) reject(error);
        else resolve(slides!);
      });
    };
    const canceled = () => finish(new Error(CANCELED_MESSAGE));
    const timer = setTimeout(() => finish(new Error(TIMED_OUT_MESSAGE)), Math.min(MAX_IMPORT_TIME_MS, Math.max(1, options.timeoutMs)));
    options.signal?.addEventListener('abort', canceled, { once: true });
    worker.once('message', (message: unknown) => {
      const reply = message as { ok?: unknown; error?: unknown; slides?: unknown } | null;
      if (reply?.ok === true && Array.isArray(reply.slides)) finish(null, reply.slides as RenderedPresentationSlide[]);
      else finish(new Error(typeof reply?.error === 'string' ? reply.error.slice(0, 1024) : 'The presentation could not be converted.'));
    });
    worker.once('error', () => finish(new Error('The presentation converter stopped unexpectedly. Try a smaller or simplified presentation.')));
    worker.once('exit', () => finish(new Error('The presentation converter stopped before completing the import.')));
  });
}

export interface PresentationImporterDependencies {
  dialogs?: Pick<typeof dialog, 'showOpenDialog'>;
  runWorker?: typeof runPresentationWorker;
  fontDirectory?: string;
  timeoutMs?: number;
}

export class PresentationImporter {
  private importing = false;

  constructor(
    private readonly mediaAssets: Pick<MediaAssetStore, 'importCollectionBundleAsset' | 'removeCollectionBundleAsset'>,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly workerPath: string,
    private readonly dependencies: PresentationImporterDependencies = {},
  ) {}

  async chooseAndImport(): Promise<ImportedPresentation | null> {
    if (this.importing) throw new Error('A presentation is already being imported.');
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error('The Stream window is not available.');
    this.importing = true;
    const abort = new AbortController();
    const cancel = () => abort.abort();
    window.once('closed', cancel);
    const imported: SlideshowImage[] = [];
    let temporaryDirectory: string | undefined;
    try {
      const selected = await (this.dependencies.dialogs ?? dialog).showOpenDialog(window, {
        title: 'Add presentation',
        properties: ['openFile'],
        filters: [{ name: 'Presentations', extensions: ['pptx', 'pdf'] }],
      });
      if (selected.canceled || !selected.filePaths[0]) return null;
      if (abort.signal.aborted || window.isDestroyed()) throw new Error(CANCELED_MESSAGE);
      const sourcePath = selected.filePaths[0];
      await validatePresentationFile(sourcePath);
      temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-presentation-'));
      const pages = await (this.dependencies.runWorker ?? runPresentationWorker)(this.workerPath, {
        sourcePath,
        outputDirectory: temporaryDirectory,
        fontDirectory: this.dependencies.fontDirectory,
      }, { timeoutMs: this.dependencies.timeoutMs ?? MAX_IMPORT_TIME_MS, signal: abort.signal });
      if (pages.length < 1 || pages.length > MAX_PRESENTATION_SLIDES) throw new Error('The presentation must contain between 1 and 100 slides.');
      const realOutputDirectory = await realpath(temporaryDirectory);
      for (const page of pages) {
        if (abort.signal.aborted || window.isDestroyed()) throw new Error(CANCELED_MESSAGE);
        if (typeof page?.path !== 'string' || typeof page.name !== 'string' || path.extname(page.path).toLowerCase() !== '.png') {
          throw new Error('The presentation converter returned an invalid slide.');
        }
        const [file, resolved] = await Promise.all([lstat(page.path), realpath(page.path)]);
        if (!file.isFile() || file.isSymbolicLink() || file.size < 1 || file.size > MAX_PAGE_BYTES || path.dirname(resolved) !== realOutputDirectory) {
          throw new Error('The presentation converter returned an invalid slide.');
        }
        const assetId = await this.mediaAssets.importCollectionBundleAsset('png', 'image', resolved);
        imported.push({ assetId, assetExtension: 'png', name: page.name.slice(0, 120) || `Slide ${imported.length + 1}` });
      }
      if (abort.signal.aborted || window.isDestroyed()) throw new Error(CANCELED_MESSAGE);
      return { name: path.basename(sourcePath, path.extname(sourcePath)).slice(0, 120), slides: imported };
    } catch (error) {
      await Promise.all(imported.map(({ assetId }) => this.mediaAssets.removeCollectionBundleAsset(assetId, 'png', 'image')));
      throw error;
    } finally {
      window.removeListener('closed', cancel);
      this.importing = false;
      if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
