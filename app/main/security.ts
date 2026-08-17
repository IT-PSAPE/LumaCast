import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BrowserWindow, net, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { resolveLocalMediaSourcePath } from '@database/media-source-utils';

const DEV_ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

type IpcEvent = IpcMainEvent | IpcMainInvokeEvent;
type CastMediaRequest = Pick<Request, 'method' | 'referrer' | 'url'> & {
  headers: Headers | Record<string, string>;
};

function readHeaderValue(request: CastMediaRequest, name: string): string | null {
  if (request.headers instanceof Headers) {
    return request.headers.get(name);
  }

  const target = name.toLowerCase();
  for (const [headerName, headerValue] of Object.entries(request.headers)) {
    if (headerName.toLowerCase() !== target) continue;
    return headerValue;
  }
  return null;
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.mov': return 'video/quicktime';
    case '.m4v': return 'video/x-m4v';
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.m4a': return 'audio/mp4';
    case '.aac': return 'audio/aac';
    case '.ogg': return 'audio/ogg';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

function parseSingleByteRange(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;

  if (!rawStart && !rawEnd) return null;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    const start = Math.max(0, fileSize - suffixLength);
    return { start, end: fileSize - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isInteger(start) || start < 0 || start >= fileSize) return null;

  if (!rawEnd) {
    return { start, end: fileSize - 1 };
  }

  const end = Number(rawEnd);
  if (!Number.isInteger(end) || end < start) return null;
  return { start, end: Math.min(end, fileSize - 1) };
}

// The packaged renderer is always loaded from this process's own build
// output (see loadRendererView in app/main/index.ts, which resolves the same
// way from its own __dirname). Bundling packs every app/main module into one
// out/main/index.js, so __dirname here is identical to index.ts's at
// runtime. Comparing for exact equality (rather than a path suffix) is
// required: a suffix check like `endsWith('/renderer/index.html')` would
// wrongly match an attacker-controlled path such as
// `/tmp/attacker/renderer/index.html`, which is a real local-file escape.
const PACKAGED_RENDERER_INDEX_PATH = path.normalize(path.join(__dirname, '../renderer/index.html'));

function matchesPackagedRendererPath(targetPath: string): boolean {
  return path.normalize(targetPath) === PACKAGED_RENDERER_INDEX_PATH;
}

function hasUrlCredentials(parsed: URL): boolean {
  return parsed.username !== '' || parsed.password !== '';
}

function isTrustedAppUrl(value: string): boolean {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'file:') {
      return matchesPackagedRendererPath(fileURLToPath(parsed));
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      // Reject credentials before trusting the host: `https://user:pass@
      // localhost/` parses with hostname `localhost` and would otherwise
      // pass the DEV_ALLOWED_HOSTS check unchanged.
      if (hasUrlCredentials(parsed)) return false;
      return DEV_ALLOWED_HOSTS.has(parsed.hostname);
    }
  } catch {
    return false;
  }

  return false;
}

export function isTrustedWebContentsUrl(value: string): boolean {
  return isTrustedAppUrl(value);
}

// Explicit allow-list of external HTTPS destinations the app may open via
// shell.openExternal from the window-open handler (issue #158). This is the
// one place the list may be extended: add an entry here, only for an https:
// destination the app deliberately links to (e.g. a Help-menu "learn more"
// item), and record the change in docs/adr/0007-renderer-navigation-trust.md.
// Never populate this list from renderer input, IPC payloads, or anything
// else outside this source file.
const APPROVED_EXTERNAL_ORIGINS: ReadonlySet<string> = new Set([
  // app/main/application-menu.ts Help menu "Learn more" item.
  'https://openai.com',
]);

// Matched by origin (scheme + host + port), not by full URL: approving an
// origin approves shell.openExternal for any path/query under that origin,
// not just the exact URL the app currently opens.
export function isApprovedExternalUrl(value: string): boolean {
  if (!value) return false;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    if (hasUrlCredentials(parsed)) return false;
    return APPROVED_EXTERNAL_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

// Used only for denial logging: reports the URL's scheme (or 'unparseable')
// without ever surfacing the rest of the URL, which for file: URLs can
// contain absolute filesystem paths.
export function describeUrlSchemeForLogging(value: string): string {
  try {
    return new URL(value).protocol;
  } catch {
    return 'unparseable';
  }
}

export function assertTrustedIpcSender(event: IpcEvent): void {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow.isDestroyed()) {
    throw new Error('IPC sender is not attached to an application window');
  }

  const topLevelUrl = event.sender.getURL();
  if (!isTrustedAppUrl(topLevelUrl)) {
    throw new Error(`Untrusted IPC sender URL: ${topLevelUrl || '<empty>'}`);
  }

  const frameUrl = event.senderFrame?.url;
  if (frameUrl && !isTrustedAppUrl(frameUrl)) {
    throw new Error(`Untrusted IPC frame URL: ${frameUrl}`);
  }
}

function extractTrustedReferrer(request: CastMediaRequest): string {
  const headerValue = readHeaderValue(request, 'referer');
  const candidate = typeof headerValue === 'string' && headerValue
    ? headerValue
    : request.referrer;
  return candidate ?? '';
}

export function resolveTrustedCastMediaRequest(request: CastMediaRequest): string | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return null;
  }

  // Chromium strips Referer for cross-scheme fetches by default (e.g. file:// →
  // cast-media://), so a missing referrer is normal in packaged builds. Only
  // reject when a referrer IS present and points somewhere we don't trust —
  // the privileged scheme registration already prevents external contexts
  // from issuing cast-media:// requests.
  const referrer = extractTrustedReferrer(request);
  if (referrer && !isTrustedAppUrl(referrer)) {
    return null;
  }

  const source = request.url;
  if (!source.startsWith('cast-media://')) {
    return null;
  }

  const filePath = resolveLocalMediaSourcePath(source);
  if (!filePath) {
    return null;
  }

  const normalizedPath = path.normalize(path.resolve(filePath));
  if (!path.isAbsolute(normalizedPath)) {
    return null;
  }

  return normalizedPath;
}

export function createForbiddenResponse(message = 'Forbidden'): Response {
  return withCorsHeaders(new Response(message, {
    status: 403,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  }));
}

export function createNotFoundResponse(message = 'Not found'): Response {
  return withCorsHeaders(new Response(message, {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  }));
}

// Allow MediaElementAudioSourceNode to read audio off cast-media:// URLs
// without tainting to silence. Pairs with crossOrigin='anonymous' on the
// renderer's <audio>/<video> elements.
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'accept-ranges, content-length, content-range, content-type',
} as const;

function withCorsHeaders(response: Response): Response {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function fetchLocalFileResponse(filePath: string, request?: CastMediaRequest): Promise<Response> {
  const range = request ? readHeaderValue(request, 'range') : null;
  const method = request?.method ?? 'GET';

  if (range) {
    const { size } = fs.statSync(filePath);
    const resolvedRange = parseSingleByteRange(range, size);
    const contentType = guessContentType(filePath);

    if (!resolvedRange) {
      return Promise.resolve(withCorsHeaders(new Response(null, {
        status: 416,
        headers: {
          'accept-ranges': 'bytes',
          'content-range': `bytes */${size}`,
          'content-type': contentType,
          'cache-control': 'no-store',
        },
      })));
    }

    const { start, end } = resolvedRange;
    const contentLength = end - start + 1;
    const headers = {
      'accept-ranges': 'bytes',
      'content-length': String(contentLength),
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-type': contentType,
      'cache-control': 'no-store',
    };

    if (method === 'HEAD') {
      return Promise.resolve(withCorsHeaders(new Response(null, {
        status: 206,
        headers,
      })));
    }

    const stream = fs.createReadStream(filePath, { start, end });
    return Promise.resolve(withCorsHeaders(new Response(Readable.toWeb(stream) as BodyInit, {
      status: 206,
      headers,
    })));
  }

  return net.fetch(pathToFileURL(filePath).toString(), { method }).then(withCorsHeaders);
}
