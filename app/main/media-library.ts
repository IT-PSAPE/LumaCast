import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SlideBackground, SlideElement } from '@lumacast/composition';
import type { AppSnapshot, MediaLibraryProgress, MediaLibraryReclaimResult } from '@lumacast/protocol';
import type { PersistenceServiceLike } from './persistence/persistence-service-proxy';
import {
  buildMediaLibraryReference,
  isMediaLibraryReference,
  mediaLibraryFileName,
  resolveLocalMediaSourcePath,
  setMediaLibraryDirectory,
} from './media-source-path';

/**
 * The app-owned copy of every imported file.
 *
 * Before this existed the database stored the path of the file the user picked,
 * so a project broke the moment they moved, renamed, or deleted the original —
 * or handed the machine to someone whose folders differ. Import now copies the
 * bytes into `<userData>/media` and stores a reference to *our* copy, so the
 * project only depends on files the app owns.
 *
 * Copies are content-addressed (`<sha256>.<ext>`), which makes re-importing the
 * same file free and makes "is this already in the library" a filename lookup
 * rather than a scan. Two asset rows can therefore share one file; that is
 * intended — the bytes are identical — and it is why nothing here ever deletes.
 * Reclaiming space is an explicit, user-initiated action.
 */
export class MediaLibraryService {
  private readonly directory: string;
  private ensured = false;
  private tempCounter = 0;

  constructor(userDataPath: string) {
    this.directory = path.join(userDataPath, 'media');
    // Both processes that resolve stored sources need the directory before any
    // library reference can be resolved; the store process configures its own
    // copy from RepositoryOptions.userDataPath.
    setMediaLibraryDirectory(this.directory);
  }

  /** Absolute path of the library directory. */
  get libraryDirectory(): string {
    return this.directory;
  }

  /**
   * Returns the stored source to persist for `source`, copying the file into
   * the library first when it is not already ours.
   *
   * Sources with nothing to copy — a reference already in the library, a
   * `blob:`/`http(s):`/relative/empty string the renderer already handles as-is
   * — are returned unchanged rather than rejected, so this can sit in front of
   * every media write without having to know which callers can produce what.
   */
  async adopt(source: string): Promise<string> {
    if (isMediaLibraryReference(source)) return source;

    const sourcePath = resolveLocalMediaSourcePath(source);
    if (!sourcePath) return source;

    // A path that already points inside the library (a re-import of a file we
    // own, or a stored absolute path from before the library existed) needs a
    // reference, not a second copy.
    const existing = this.libraryFileNameForPath(sourcePath);
    if (existing) return buildMediaLibraryReference(existing);

    const stats = await fs.promises.stat(sourcePath).catch(() => null);
    if (!stats?.isFile()) {
      throw new Error(UNREADABLE_SOURCE_MESSAGE);
    }

    const fileName = `${await hashFile(sourcePath)}${normalizeExtension(sourcePath)}`;
    await this.ensureDirectory();
    const target = path.join(this.directory, fileName);

    // Same content-addressed name and the same size means the library already
    // holds this file. A size mismatch means a previous copy was interrupted
    // before its rename, so it is replaced rather than trusted.
    const targetStats = await fs.promises.stat(target).catch(() => null);
    if (targetStats?.isFile() && targetStats.size === stats.size) {
      return buildMediaLibraryReference(fileName);
    }

    await this.copyIntoLibrary(sourcePath, target);
    return buildMediaLibraryReference(fileName);
  }

  /**
   * Copies every asset that still points outside the library into it, one at a
   * time, repointing the asset and everything that uses it as each copy lands.
   *
   * This is what makes projects created before the library safe. It runs in the
   * background rather than at startup because a large library is a lot of
   * bytes, and it reports each repoint as a patch so the renderer's snapshot —
   * and therefore undo — never diverges from what is on disk.
   *
   * A source that cannot be read is left exactly as it is: the file is already
   * gone, and the honest outcome is the missing-media state, not a rewritten
   * reference to a copy that was never made.
   */
  async adoptExistingAssets(
    repo: MediaLibraryAdoptionRepository,
    options: {
      onProgress?: (progress: MediaLibraryProgress) => void;
      isCancelled?: () => boolean;
    } = {},
  ): Promise<MediaLibraryAdoptionResult> {
    const snapshot = await repo.getSnapshot();
    const pending = snapshot.mediaAssets.filter((asset) => (
      asset.src
      && !isMediaLibraryReference(asset.src)
      && resolveLocalMediaSourcePath(asset.src) !== null
    ));
    const result: MediaLibraryAdoptionResult = { adopted: 0, unreadable: 0, failed: 0, cancelled: false };
    if (pending.length === 0) return result;

    for (const asset of pending) {
      if (options.isCancelled?.()) {
        result.cancelled = true;
        break;
      }

      try {
        const reference = await this.adopt(asset.src);
        if (reference === asset.src) continue;
        // The bytes are identical to what was probed before, so the persisted
        // width/height/duration/codec stay truthful and are kept.
        const patch = await repo.updateMediaAssetSrc(asset.id, reference, { preserveMetadata: true });
        result.adopted += 1;
        options.onProgress?.({
          copied: result.adopted,
          total: pending.length,
          statusText: `Copying media into the library (${result.adopted}/${pending.length})`,
          patch,
        });
      } catch (error) {
        if (isUnreadableSourceError(error)) {
          result.unreadable += 1;
          continue;
        }
        console.error('[MediaLibrary] Failed to adopt media asset', asset.id, error);
        result.failed += 1;
      }
    }

    options.onProgress?.({ copied: result.adopted, total: pending.length, statusText: null });
    return result;
  }

  /**
   * Deletes library files nothing in the project references any more.
   *
   * Nothing else in this class ever deletes: media references are copied by
   * value into every element that uses them, so an incomplete reference scan
   * would destroy a file still in use. Reclaiming is therefore explicit, and
   * this scan only ever removes files whose names we wrote ourselves — a
   * content-addressed copy, or an abandoned `.part` from an interrupted copy.
   *
   * The reference set is the live project only. Undo history is not consulted,
   * so undoing past a reclaim can restore an element whose file is now gone —
   * which the missing-media state then reports truthfully.
   */
  async reclaim(repo: MediaLibraryReclaimRepository): Promise<MediaLibraryReclaimResult> {
    const referenced = collectReferencedLibraryFiles(await repo.getSnapshot());
    const entries = await fs.promises.readdir(this.directory, { withFileTypes: true }).catch(() => []);
    const result: MediaLibraryReclaimResult = { removedFiles: 0, freedBytes: 0, keptFiles: 0 };

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const target = path.join(this.directory, entry.name);
      const isCopy = LIBRARY_FILE_NAME_PATTERN.test(entry.name);
      const isAbandonedPart = entry.name.endsWith(PART_SUFFIX);
      if (!isCopy && !isAbandonedPart) continue;

      if (isCopy && referenced.has(entry.name)) {
        result.keptFiles += 1;
        continue;
      }

      const stats = await fs.promises.stat(target).catch(() => null);
      if (!stats) continue;
      // A `.part` file may belong to a copy running right now, so only clearly
      // abandoned ones are swept.
      if (isAbandonedPart && Date.now() - stats.mtimeMs < ABANDONED_PART_AGE_MS) continue;

      try {
        await fs.promises.rm(target);
        result.removedFiles += 1;
        result.freedBytes += stats.size;
      } catch (error) {
        console.error('[MediaLibrary] Failed to remove unreferenced library file', entry.name, error);
      }
    }

    return result;
  }

  private async ensureDirectory(): Promise<void> {
    if (this.ensured) return;
    await fs.promises.mkdir(this.directory, { recursive: true });
    this.ensured = true;
  }

  /**
   * Copies through a temporary file in the same directory and renames it into
   * place: a crash mid-copy must never leave a truncated file under a
   * content-addressed name, because the next import would take that name as
   * proof the bytes are already there.
   */
  private async copyIntoLibrary(sourcePath: string, target: string): Promise<void> {
    this.tempCounter += 1;
    const temporary = `${target}.${process.pid}.${this.tempCounter}${PART_SUFFIX}`;
    try {
      // FICLONE makes this a copy-on-write clone on filesystems that support
      // it (APFS, Btrfs, XFS): instant, and no extra disk until one side is
      // written to. It falls back to a real copy everywhere else.
      await fs.promises.copyFile(sourcePath, temporary, fs.constants.COPYFILE_FICLONE);
      await fs.promises.rename(temporary, target);
    } catch (error) {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  /** The library file name for `filePath` when it already lives in the library. */
  private libraryFileNameForPath(filePath: string): string | null {
    const relative = path.relative(this.directory, path.resolve(filePath));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return mediaLibraryFileName(`cast-media://library/${relative}`);
  }
}

/** What `adoptExistingAssets` needs from persistence, and nothing more. */
export type MediaLibraryAdoptionRepository = Pick<PersistenceServiceLike, 'getSnapshot' | 'updateMediaAssetSrc'>;

export interface MediaLibraryAdoptionResult {
  adopted: number;
  /** Sources whose file is already gone; left alone so they read as missing. */
  unreadable: number;
  failed: number;
  cancelled: boolean;
}

export type MediaLibraryReclaimRepository = Pick<PersistenceServiceLike, 'getSnapshot'>;

const UNREADABLE_SOURCE_MESSAGE = 'Media source could not be read for import';
const PART_SUFFIX = '.part';
const ABANDONED_PART_AGE_MS = 60 * 60 * 1000;
/** Mirrors the stored-reference pattern in `media-source-path.ts`. */
const LIBRARY_FILE_NAME_PATTERN = /^[0-9a-f]{64}(?:\.[a-z0-9]{1,12})?$/;

/**
 * Every library file the project still points at.
 *
 * The shapes walked here mirror `maskAppSnapshot` in `media-capability.ts`,
 * which is the authoritative list of media-bearing snapshot shapes — it has to
 * be complete or paths leak, so it is the right list to copy. Backgrounds are
 * included deliberately: the deck-bundle scanners omit them, and inheriting
 * that gap here would delete a file a slide background still uses.
 */
function collectReferencedLibraryFiles(snapshot: AppSnapshot): Set<string> {
  const referenced = new Set<string>();

  const addSource = (source: string | null | undefined) => {
    if (typeof source !== 'string') return;
    const fileName = mediaLibraryFileName(source);
    if (fileName) referenced.add(fileName);
  };

  const addBackground = (background: SlideBackground | null | undefined) => {
    if (!background) return;
    if (background.type !== 'image' && background.type !== 'video') return;
    addSource(background.src);
  };

  const addElement = (element: SlideElement) => {
    const fields = element.payload as unknown as Record<string, unknown>;
    if (element.type === 'group') {
      const children = fields.children;
      if (Array.isArray(children)) (children as SlideElement[]).forEach(addElement);
      return;
    }
    if (element.type === 'image' || element.type === 'video') addSource(fields.src as string | undefined);
  };

  const addComposition = (entity: { background?: SlideBackground | null; elements: SlideElement[] }) => {
    addBackground(entity.background);
    entity.elements.forEach(addElement);
  };

  for (const asset of snapshot.mediaAssets) addSource(asset.src);
  for (const slide of snapshot.slides) addBackground(slide.background);
  snapshot.slideElements.forEach(addElement);
  for (const composition of [
    ...snapshot.presentationThemes,
    ...snapshot.lyricThemes,
    ...snapshot.talkThemes,
    ...snapshot.overlayThemes,
    ...snapshot.overlays,
    ...snapshot.stages,
  ]) addComposition(composition);

  return referenced;
}

function isUnreadableSourceError(error: unknown): boolean {
  return error instanceof Error && error.message === UNREADABLE_SOURCE_MESSAGE;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

/**
 * Keeps the original extension when it is one the rest of the stack can read
 * back — `nativeImage`, `music-metadata` and mime sniffing all key off it — and
 * drops anything that would not survive the library reference pattern.
 */
function normalizeExtension(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(extension) ? `.${extension}` : '';
}
