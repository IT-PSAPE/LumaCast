import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, lstat, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dialog, type BrowserWindow } from 'electron';
import { open as openZip, type Entry, type ZipFile } from 'yauzl';
import { ZipFile as ZipWriter } from 'yazl';
import type { MediaKind, StreamProject, StreamSource, StreamWorkspace } from '../shared/desktop-api';
import { flattenSourceLeaves } from '../shared/source-tree';
import { MediaAssetStore } from './media-assets';
import { ProjectStore } from './project-store';

const BUNDLE_FORMAT = 'lumastream-scene-collection';
const BUNDLE_VERSION = 1;
const MAX_BUNDLE_ARCHIVE_BYTES = 12 * 1024 * 1024 * 1024;
const MAX_BUNDLE_TOTAL_BYTES = 12 * 1024 * 1024 * 1024;
const MAX_BUNDLE_ENTRY_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 40 * 1024 * 1024;
const MAX_BUNDLE_ENTRIES = 2049;
const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_ENTRY_PATTERN = /^assets\/([0-9a-f-]{36})\.([a-z0-9]+)$/i;

interface BundleAsset {
  id: string;
  name: string;
  kind: MediaKind;
  extension: string;
  size: number;
  sha256: string;
}

interface SceneCollectionBundle {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  name: string;
  project: unknown;
  assets: BundleAsset[];
}

interface StagedEntry {
  path: string;
  size: number;
  sha256: string;
}

interface ExpectedAsset {
  id: string;
  extension: string;
  kind: MediaKind;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeFileStem(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').slice(0, 100) || 'Scene Collection';
}

function remapSourceAssets(source: StreamSource, assetMap: Map<string, string>): StreamSource {
  return {
    ...source,
    ...(source.assetId && assetMap.has(source.assetId) ? { assetId: assetMap.get(source.assetId)! } : {}),
    ...(source.kind === 'slideshow' ? { slideshowImages: source.slideshowImages?.map((image) => ({ ...image, assetId: assetMap.get(image.assetId) ?? image.assetId })) } : {}),
    ...(source.kind === 'group' ? { children: (source.children ?? []).map((child) => remapSourceAssets(child, assetMap)) } : {}),
  };
}

function collectionAssets(project: StreamProject): Map<string, ExpectedAsset> {
  const assets = new Map<string, ExpectedAsset>();
  for (const scene of project.scenes) {
    for (const source of flattenSourceLeaves(scene.sources)) {
      const sourceAssets = source.kind === 'image' || source.kind === 'media'
        ? [{ id: source.assetId, extension: source.assetExtension, kind: source.kind === 'image' ? 'image' : source.mediaKind, name: source.name }]
        : source.kind === 'slideshow'
          ? (source.slideshowImages ?? []).map((image) => ({ id: image.assetId, extension: image.assetExtension, kind: 'image' as const, name: image.name }))
          : [];
      for (const asset of sourceAssets) {
        const { id, extension, kind, name } = asset;
        if (!id || !extension || (kind !== 'image' && kind !== 'video' && kind !== 'audio') || !ASSET_ID_PATTERN.test(id)) {
          throw new Error('The scene collection has an invalid media source.');
        }
        const previous = assets.get(id);
        if (previous && (previous.extension !== extension || previous.kind !== kind)) {
          throw new Error('The scene collection reuses a media asset with conflicting types.');
        }
        assets.set(id, previous ?? { id, extension, kind, name });
      }
    }
  }
  return assets;
}

function openReadStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else if (!stream) reject(new Error('The collection archive entry could not be opened.'));
      else resolve(stream);
    });
  });
}

async function readSmallEntry(zip: ZipFile, entry: Entry, maximumBytes: number): Promise<Buffer> {
  const stream = await openReadStream(zip, entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const item of stream) {
    const chunk = Buffer.isBuffer(item) ? item : Buffer.from(item);
    size += chunk.byteLength;
    if (size > maximumBytes) throw new Error('The collection manifest exceeds the size limit.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function stageEntry(zip: ZipFile, entry: Entry, stagePath: string, maximumBytes: number): Promise<StagedEntry> {
  const stream = await openReadStream(zip, entry);
  let size = 0;
  const hash = createHash('sha256');
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength;
      if (size > maximumBytes) {
        callback(new Error('A collection media asset exceeds the import size limit.'));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(stream, meter, createWriteStream(stagePath, { flags: 'wx' }));
  return { path: stagePath, size, sha256: hash.digest('hex') };
}

function openArchive(filePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    openZip(filePath, { autoClose: false, lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) reject(error);
      else if (!zip) reject(new Error('The selected file is not a valid collection archive.'));
      else resolve(zip);
    });
  });
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export class CollectionBundleStore {
  constructor(
    private readonly projects: ProjectStore,
    private readonly mediaAssets: MediaAssetStore,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly dialogs: Pick<typeof dialog, 'showSaveDialog' | 'showOpenDialog'> = dialog,
  ) {}

  async exportCollection(id: string): Promise<boolean> {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error('The Stream window is not available.');
    const collection = await this.projects.exportCollection(id);
    const result = await this.dialogs.showSaveDialog(window, {
      title: 'Export Scene Collection',
      defaultPath: `${safeFileStem(collection.name)}.lumacollection`,
      filters: [{ name: 'LumaStream Scene Collection', extensions: ['lumacollection'] }],
    });
    if (result.canceled || !result.filePath) return false;
    const outputPath = path.extname(result.filePath).toLowerCase() === '.lumacollection'
      ? result.filePath
      : `${result.filePath}.lumacollection`;

    const referencedAssets = collectionAssets(collection.project);
    if (referencedAssets.size + 1 > MAX_BUNDLE_ENTRIES) throw new Error('The scene collection references too many media assets to export.');
    const assets: BundleAsset[] = [];
    let totalSize = 0;
    const zip = new ZipWriter();
    const temporaryPath = `${outputPath}.${crypto.randomUUID()}.tmp`;
    const writePromise = pipeline(zip.outputStream, createWriteStream(temporaryPath, { flags: 'wx' }));
    try {
      for (const asset of referencedAssets.values()) {
        const file = await this.mediaAssets.getCollectionBundleAsset(asset.id, asset.extension, asset.kind);
        totalSize += file.size;
        if (totalSize > MAX_BUNDLE_TOTAL_BYTES) throw new Error('The scene collection media exceeds the export size limit.');
        assets.push({ ...asset, size: file.size, sha256: await hashFile(file.path) });
        zip.addFile(file.path, `assets/${asset.id}.${asset.extension}`, { compress: false });
      }
      const bundle: SceneCollectionBundle = {
        format: BUNDLE_FORMAT,
        version: BUNDLE_VERSION,
        name: collection.name,
        project: collection.project,
        assets,
      };
      zip.addBuffer(Buffer.from(JSON.stringify(bundle), 'utf8'), 'collection.json', { compress: true });
      zip.end();
      await writePromise;
      await rename(temporaryPath, outputPath);
      return true;
    } catch (error) {
      zip.outputStream.destroy(error instanceof Error ? error : new Error('Scene collection export failed.'));
      await writePromise.catch(() => undefined);
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  async importCollection(): Promise<StreamWorkspace | null> {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error('The Stream window is not available.');
    const result = await this.dialogs.showOpenDialog(window, {
      title: 'Import Scene Collection',
      properties: ['openFile'],
      filters: [{ name: 'LumaStream Scene Collection', extensions: ['lumacollection', 'zip'] }],
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) return null;
    return this.importFromPath(filePath);
  }

  async importFromPath(filePath: string): Promise<StreamWorkspace> {
    const archiveInfo = await lstat(filePath);
    if (archiveInfo.isSymbolicLink() || !archiveInfo.isFile() || archiveInfo.size < 22 || archiveInfo.size > MAX_BUNDLE_ARCHIVE_BYTES) {
      throw new Error('The collection archive is empty or exceeds the import size limit.');
    }
    const stageDirectory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-collection-'));
    const importedAssets: Array<{ id: string; extension: string; kind: MediaKind }> = [];
    try {
      const { manifestBytes, entries } = await this.stageArchive(filePath, stageDirectory);
      const manifest = this.decodeManifest(manifestBytes);
      const project = this.projects.validateImportedProject(manifest.project);
      const referenced = collectionAssets(project);
      if (referenced.size !== manifest.assets.length || manifest.assets.length !== entries.size) {
        throw new Error('The collection archive does not match its media manifest.');
      }
      const assetMap = new Map<string, string>();
      const seenAssetIds = new Set<string>();
      for (const asset of manifest.assets) {
        if (!isRecord(asset) || typeof asset.id !== 'string' || !ASSET_ID_PATTERN.test(asset.id)
          || typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 120
          || (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'audio')
          || typeof asset.extension !== 'string'
          || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_BUNDLE_ENTRY_BYTES
          || typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(asset.sha256)) {
          throw new Error('The collection archive contains an invalid media manifest entry.');
        }
        const expected = referenced.get(asset.id);
        const archivePath = `assets/${asset.id}.${asset.extension}`;
        const staged = entries.get(archivePath);
        if (!expected || expected.extension !== asset.extension || expected.kind !== asset.kind || !staged
          || staged.size !== asset.size || staged.sha256 !== asset.sha256.toLowerCase()) {
          throw new Error('A collection media asset did not match its manifest.');
        }
        if (seenAssetIds.has(asset.id)) throw new Error('The collection media manifest contains duplicate assets.');
        seenAssetIds.add(asset.id);
      }
      for (const asset of manifest.assets) {
        const staged = entries.get(`assets/${asset.id}.${asset.extension}`)!;
        const newId = await this.mediaAssets.importCollectionBundleAsset(asset.extension, asset.kind, staged.path);
        importedAssets.push({ id: newId, extension: asset.extension, kind: asset.kind });
        assetMap.set(asset.id, newId);
      }
      const remapped: StreamProject = {
        ...project,
        scenes: project.scenes.map((scene) => ({
          ...scene,
          sources: scene.sources.map((source) => remapSourceAssets(source, assetMap)),
        })),
      };
      return await this.projects.importCollection(manifest.name, remapped);
    } catch (error) {
      await Promise.all(importedAssets.map((asset) => this.mediaAssets.removeCollectionBundleAsset(asset.id, asset.extension, asset.kind)));
      throw error;
    } finally {
      await rm(stageDirectory, { recursive: true, force: true });
    }
  }

  private decodeManifest(bytes: Buffer): SceneCollectionBundle {
    let value: unknown;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('The collection manifest is not valid JSON.'); }
    if (!isRecord(value) || value.format !== BUNDLE_FORMAT || value.version !== BUNDLE_VERSION
      || typeof value.name !== 'string' || !Array.isArray(value.assets) || value.assets.length + 1 > MAX_BUNDLE_ENTRIES) {
      throw new Error('This file is not a supported LumaStream scene collection.');
    }
    return value as unknown as SceneCollectionBundle;
  }

  private async stageArchive(filePath: string, stageDirectory: string): Promise<{ manifestBytes: Buffer; entries: Map<string, StagedEntry> }> {
    const zip = await openArchive(filePath);
    const entries = new Map<string, StagedEntry>();
    let manifestBytes: Buffer | null = null;
    let totalSize = 0;
    try {
      if (zip.entryCount < 1 || zip.entryCount > MAX_BUNDLE_ENTRIES) throw new Error('The collection archive contains too many files.');
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          if (zip.isOpen) zip.close();
          reject(error);
        };
        zip.once('error', fail);
        zip.on('end', () => {
          if (settled) return;
          settled = true;
          resolve();
        });
        zip.on('entry', (entry: Entry) => {
          void (async () => {
            if (entry.isEncrypted() || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0
              || entry.uncompressedSize > MAX_BUNDLE_ENTRY_BYTES) throw new Error('The collection archive contains an unsupported entry.');
            if (entry.fileName !== 'collection.json' && !ASSET_ENTRY_PATTERN.test(entry.fileName)) {
              throw new Error('The collection archive contains an unexpected file path.');
            }
            if (entries.has(entry.fileName) || (entry.fileName === 'collection.json' && manifestBytes)) {
              throw new Error('The collection archive contains duplicate paths.');
            }
            totalSize += entry.uncompressedSize;
            if (totalSize > MAX_BUNDLE_TOTAL_BYTES + MAX_MANIFEST_BYTES) throw new Error('The collection archive expands beyond the size limit.');
            if (entry.fileName === 'collection.json') {
              manifestBytes = await readSmallEntry(zip, entry, MAX_MANIFEST_BYTES);
              return;
            }
            const stagePath = path.join(stageDirectory, crypto.randomUUID());
            entries.set(entry.fileName, await stageEntry(zip, entry, stagePath, MAX_BUNDLE_ENTRY_BYTES));
          })().then(() => {
            if (!settled) zip.readEntry();
          }).catch((error: unknown) => fail(error instanceof Error ? error : new Error('The collection archive could not be read.')));
        });
        zip.readEntry();
      });
    } finally {
      if (zip.isOpen) zip.close();
    }
    if (!manifestBytes) throw new Error('The collection archive has no collection manifest.');
    return { manifestBytes, entries };
  }
}
