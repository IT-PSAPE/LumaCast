// The `lumachord:` scheme is how the sandboxed renderer ever sees a local
// media file: it never receives a raw filesystem path, only a scheme URL
// built from one, and that URL only resolves when the path was admitted
// through the open dialog, drag-drop admission, or project open (see
// MediaAdmissions below). Everything else is a 403, which is what keeps a
// compromised renderer from reading arbitrary files off disk by guessing a
// `lumachord://file/<path>` URL.
//
// This module is pure aside from `MediaAdmissions.admit` (which stats the
// file) and `createMediaProtocolHandler` (which streams it); URL building/
// parsing, extension-to-kind mapping, and Range-header parsing are plain
// functions so they are unit-testable without Electron.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ImportedFile, ImportKind } from '../shared/desktop-api';

export const MEDIA_SCHEME = 'lumachord';

/** Registered with `protocol.registerSchemesAsPrivileged` before `app.whenReady()`. */
export const MEDIA_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  bypassCSP: false,
} as const;

/** Extensions admitted per import kind (lower-case, no leading dot). */
export const MEDIA_EXTENSIONS_BY_KIND: Readonly<Record<ImportKind, readonly string[]>> = {
  audio: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'aiff'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
  video: ['mp4', 'mov', 'm4v', 'webm', 'mkv'],
  cues: ['csv', 'lrc', 'srt', 'txt'],
};

/** A generous ceiling, not a realistic file size: it exists so an admission
 *  request cannot be used to quietly memory-map or hash an arbitrarily large
 *  file main never intended to treat as media. */
export const MAX_ADMITTED_FILE_SIZE_BYTES = 4 * 1024 * 1024 * 1024;

const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  aiff: 'audio/aiff',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  csv: 'text/csv',
  lrc: 'text/plain',
  srt: 'text/plain',
  txt: 'text/plain',
};

function extensionOf(filePath: string): string {
  return path.extname(filePath).slice(1).toLowerCase();
}

/** The import kind an extension belongs to, or null when it matches none. */
export function kindForPath(filePath: string): ImportKind | null {
  const extension = extensionOf(filePath);
  if (!extension) return null;
  for (const kind of Object.keys(MEDIA_EXTENSIONS_BY_KIND) as ImportKind[]) {
    if (MEDIA_EXTENSIONS_BY_KIND[kind].includes(extension)) return kind;
  }
  return null;
}

function contentTypeForPath(filePath: string): string {
  return CONTENT_TYPE_BY_EXTENSION[extensionOf(filePath)] ?? 'application/octet-stream';
}

/** `lumachord://file/<encodeURIComponent(absolutePath)>`. */
export function buildMediaUrl(absolutePath: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(absolutePath)}`;
}

/** Inverse of buildMediaUrl; null for anything not in that exact shape. */
export function parseMediaUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null;
  if (parsed.hostname !== 'file') return null;
  const encoded = parsed.pathname.replace(/^\/+/, '');
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export interface ByteRange {
  start: number;
  end: number;
}

/** Parses a single-range `Range: bytes=...` header against a known file size.
 *  Multi-range requests (`bytes=0-1,5-6`) are not supported and return null,
 *  which the caller treats as "serve the whole file" — no media player this
 *  app targets sends a multi-range request for seeking. */
export function parseByteRange(rangeHeader: string, fileSize: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, fileSize - suffixLength), end: fileSize - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isInteger(start) || start < 0 || start >= fileSize) return null;

  if (!rawEnd) return { start, end: fileSize - 1 };

  const end = Number(rawEnd);
  if (!Number.isInteger(end) || end < start) return null;
  return { start, end: Math.min(end, fileSize - 1) };
}

/**
 * The admitted-path allow-list. A path resolves on the `lumachord:` scheme
 * only after it passes through `admit` (from the open dialog, drag-drop, or a
 * project's own audio/background paths on open) — never from a bare renderer
 * request, and never for a path outside this in-memory set. Admission is
 * session-scoped: closing and reopening a project re-admits its media, which
 * is deliberate (a project file discovered on disk grants nothing until main
 * has itself opened it).
 */
export class MediaAdmissions {
  private readonly admittedKinds = new Map<string, ImportKind>();

  /**
   * Validates and admits `filePath` for `kind`: must be absolute, exist as a
   * regular file, have an extension that matches `kind`, and be at or under
   * the 4 GB ceiling. Throws on any failure; the caller (an IPC handler) is
   * expected to either propagate that rejection or, for a best-effort batch
   * such as `admitFiles`, catch and skip the entry.
   */
  async admit(filePath: string, kind: ImportKind): Promise<ImportedFile> {
    if (!path.isAbsolute(filePath)) {
      throw new Error(`Refusing to admit a non-absolute path: ${filePath}`);
    }
    if (!MEDIA_EXTENSIONS_BY_KIND[kind].includes(extensionOf(filePath))) {
      throw new Error(`Refusing to admit ${filePath}: extension does not match kind "${kind}"`);
    }

    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      throw new Error(`File does not exist: ${filePath}`);
    }
    if (!stats.isFile()) {
      throw new Error(`Not a regular file: ${filePath}`);
    }
    if (stats.size > MAX_ADMITTED_FILE_SIZE_BYTES) {
      throw new Error(`File exceeds the ${MAX_ADMITTED_FILE_SIZE_BYTES} byte import limit: ${filePath}`);
    }

    this.admittedKinds.set(filePath, kind);

    return {
      kind,
      path: filePath,
      name: path.basename(filePath),
      // Cue files are read as text over the `readCueFile` channel, never
      // fetched as a scheme URL, so they carry no media URL.
      url: kind === 'cues' ? null : buildMediaUrl(filePath),
      sizeBytes: stats.size,
    };
  }

  isAdmitted(filePath: string): boolean {
    return this.admittedKinds.has(filePath);
  }

  kindOf(filePath: string): ImportKind | null {
    return this.admittedKinds.get(filePath) ?? null;
  }
}

type ProtocolRequest = Pick<Request, 'method' | 'url' | 'headers'>;

/**
 * Builds the `protocol.handle('lumachord', ...)` callback. GET/HEAD only,
 * admitted paths only, single-range support for `<audio>`/`<video>` seeking.
 * Kept as a factory (rather than a bare function importing `MediaAdmissions`
 * globally) so main/index.ts owns the one registry instance and tests can
 * exercise this against a fake admissions object with no Electron runtime.
 */
export function createMediaProtocolHandler(
  admissions: Pick<MediaAdmissions, 'isAdmitted'>,
): (request: ProtocolRequest) => Promise<Response> {
  return async (request: ProtocolRequest): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 });
    }

    const filePath = parseMediaUrl(request.url);
    if (!filePath || !admissions.isAdmitted(filePath)) {
      return new Response(null, { status: 403 });
    }

    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      return new Response(null, { status: 404 });
    }

    const contentType = contentTypeForPath(filePath);
    const rangeHeader = request.headers.get('range');

    if (rangeHeader) {
      const range = parseByteRange(rangeHeader, stats.size);
      if (!range) {
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${stats.size}` },
        });
      }

      const { start, end } = range;
      const headers = {
        'content-type': contentType,
        'accept-ranges': 'bytes',
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${stats.size}`,
      };

      if (request.method === 'HEAD') {
        return new Response(null, { status: 206, headers });
      }

      const stream = createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as unknown as BodyInit, { status: 206, headers });
    }

    const headers = {
      'content-type': contentType,
      'accept-ranges': 'bytes',
      'content-length': String(stats.size),
    };

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    const stream = createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, { status: 200, headers });
  };
}
