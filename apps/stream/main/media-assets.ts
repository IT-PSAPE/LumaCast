import { copyFile, mkdir, open, lstat, realpath, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { constants } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { dialog, type BrowserWindow } from 'electron';
import type { MediaAsset, MediaKind } from '../shared/desktop-api';

export const MEDIA_SCHEME = 'lumastream';
export const MEDIA_SCHEME_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false } as const;

const EXTENSIONS: Record<MediaKind, readonly string[]> = {
  image: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'],
  audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'],
};
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', gif: 'image/gif', webp: 'image/webp',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/opus',
};
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BUNDLE_ASSET_BYTES = 4 * 1024 * 1024 * 1024;
const MEDIA_RESPONSE_CORS_HEADERS = { 'access-control-allow-origin': '*' };

function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[2] && match[1] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isInteger(start) && start >= 0 && start < size && Number.isInteger(end) && end >= start
    ? { start, end }
    : null;
}

export class MediaAssetStore {
  private readonly directory: string;

  constructor(
    dataDirectory: string,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly dialogs: Pick<typeof dialog, 'showOpenDialog'> = dialog,
  ) {
    this.directory = path.join(dataDirectory, 'media');
  }

  async chooseAndImport(kind: MediaKind): Promise<MediaAsset | null> {
    if (!Object.hasOwn(EXTENSIONS, kind)) throw new Error('Unsupported imported media type.');
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error('The Stream window is not available.');
    const extensions = EXTENSIONS[kind];
    const result = await this.dialogs.showOpenDialog(window, {
      title: `Add ${kind}`,
      properties: ['openFile'],
      filters: [{ name: kind === 'image' ? 'Images' : kind === 'video' ? 'Video' : 'Audio', extensions: [...extensions] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;

    return this.importFile(result.filePaths[0], kind);
  }

  async chooseAndImportImages(maxImages: number): Promise<MediaAsset[]> {
    if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 100) throw new Error('The slideshow image limit is invalid.');
    const window = this.getWindow();
    if (!window || window.isDestroyed()) throw new Error('The Stream window is not available.');
    const result = await this.dialogs.showOpenDialog(window, {
      title: 'Add slideshow images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: [...EXTENSIONS.image] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    if (result.filePaths.length > maxImages) throw new Error(`Choose no more than ${maxImages} slideshow ${maxImages === 1 ? 'image' : 'images'}.`);

    const assets: MediaAsset[] = [];
    try {
      for (const sourcePath of result.filePaths) assets.push(await this.importFile(sourcePath, 'image'));
      return assets;
    } catch (error) {
      await Promise.all(assets.map((asset) => unlink(path.join(this.directory, `${asset.id}.${asset.extension}`)).catch(() => undefined)));
      throw error;
    }
  }

  private async importFile(sourcePath: string, kind: MediaKind): Promise<MediaAsset> {
    const extension = path.extname(sourcePath).slice(1).toLowerCase();
    if (!EXTENSIONS[kind].includes(extension)) throw new Error('The selected file type is not supported.');
    await mkdir(this.directory, { recursive: true });
    const id = crypto.randomUUID();
    const fileName = `${id}.${extension}`;
    const destination = path.join(this.directory, fileName);
    try {
      await copyFile(sourcePath, destination);
      const info = await open(destination, 'r');
      try {
        const stat = await info.stat();
        if (!stat.isFile() || stat.size === 0) throw new Error('The selected file is empty or invalid.');
      } finally {
        await info.close();
      }
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      throw error;
    }
    return { id, name: path.basename(sourcePath, path.extname(sourcePath)), kind, extension };
  }

  async getCollectionBundleAsset(id: string, extension: string, kind: MediaKind): Promise<{ path: string; size: number }> {
    if (!Object.hasOwn(EXTENSIONS, kind) || !EXTENSIONS[kind].includes(extension) || !ID_PATTERN.test(id)) {
      throw new Error('The collection contains an invalid media asset reference.');
    }
    const target = path.join(this.directory, `${id}.${extension}`);
    const [realDirectory, directoryInfo] = await Promise.all([realpath(this.directory), lstat(this.directory)]);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) throw new Error('The Stream media directory is invalid.');
    const [realTarget, fileInfo] = await Promise.all([realpath(target), lstat(target)]);
    if (fileInfo.isSymbolicLink() || !fileInfo.isFile() || path.dirname(realTarget) !== realDirectory || fileInfo.size < 1 || fileInfo.size > MAX_BUNDLE_ASSET_BYTES) {
      throw new Error('A collection media asset is missing or exceeds the bundle size limit.');
    }
    return { path: realTarget, size: fileInfo.size };
  }

  async importCollectionBundleAsset(extension: string, kind: MediaKind, sourcePath: string): Promise<string> {
    if (!Object.hasOwn(EXTENSIONS, kind) || !EXTENSIONS[kind].includes(extension)) throw new Error('The collection contains an unsupported media type.');
    const sourceInfo = await lstat(sourcePath);
    if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile() || sourceInfo.size < 1 || sourceInfo.size > MAX_BUNDLE_ASSET_BYTES) {
      throw new Error('A bundled media asset is empty or exceeds the import size limit.');
    }
    await mkdir(this.directory, { recursive: true });
    const id = crypto.randomUUID();
    const destination = path.join(this.directory, `${id}.${extension}`);
    try {
      await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
    } catch (error) {
      await unlink(destination).catch(() => undefined);
      throw error;
    }
    return id;
  }

  async removeCollectionBundleAsset(id: string, extension: string, kind: MediaKind): Promise<void> {
    if (!Object.hasOwn(EXTENSIONS, kind) || !EXTENSIONS[kind].includes(extension) || !ID_PATTERN.test(id)) return;
    await unlink(path.join(this.directory, `${id}.${extension}`)).catch(() => undefined);
  }

  handler() {
    const directory = this.directory;
    return async (request: Pick<Request, 'method' | 'url' | 'headers'>): Promise<Response> => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
      let url: URL;
      try { url = new URL(request.url); } catch { return new Response(null, { status: 403 }); }
      const match = /^\/([0-9a-f-]{36})\.([a-z0-9]+)$/i.exec(url.pathname);
      const assetId = match?.[1] ?? '';
      const extension = match?.[2]?.toLowerCase() ?? '';
      if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== 'media' || !ID_PATTERN.test(assetId) || !Object.hasOwn(MIME, extension) || url.search || url.hash) {
        return new Response(null, { status: 403 });
      }
      try {
        const [realDirectory, directoryInfo] = await Promise.all([realpath(directory), lstat(directory)]);
        if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) return new Response(null, { status: 403 });
        const target = path.join(directory, `${assetId}.${extension}`);
        const [realTarget, fileInfo] = await Promise.all([realpath(target), lstat(target)]);
        if (fileInfo.isSymbolicLink() || !fileInfo.isFile() || path.dirname(realTarget) !== realDirectory) return new Response(null, { status: 403 });
        const filePath = realTarget;
        const info = await open(filePath, 'r');
        let size: number;
        try { size = (await info.stat()).size; } finally { await info.close(); }
        const rangeHeader = request.headers.get('range');
        if (rangeHeader) {
          const range = parseRange(rangeHeader, size);
          if (!range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
          const headers = {
            ...MEDIA_RESPONSE_CORS_HEADERS,
            'content-type': MIME[extension]!,
            'accept-ranges': 'bytes',
            'content-length': String(range.end - range.start + 1),
            'content-range': `bytes ${range.start}-${range.end}/${size}`,
          };
          return request.method === 'HEAD'
            ? new Response(null, { status: 206, headers })
            : new Response(Readable.toWeb(createReadStream(filePath, range)) as unknown as BodyInit, { status: 206, headers });
        }
        const headers = { ...MEDIA_RESPONSE_CORS_HEADERS, 'content-type': MIME[extension]!, 'accept-ranges': 'bytes', 'content-length': String(size) };
        return request.method === 'HEAD'
          ? new Response(null, { status: 200, headers })
          : new Response(Readable.toWeb(createReadStream(filePath)) as unknown as BodyInit, { status: 200, headers });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Response(null, { status: 404 });
        console.error('[stream] media asset could not be served', error);
        return new Response(null, { status: 500 });
      }
    };
  }
}
