// `npm run preview:browser`: serves the built Cast renderer
// (apps/cast/out/renderer, from `npm run build:cast`) to a plain Chrome browser instead of Electron, with the
// user's REAL project data, read-only, so a design-capture extension can grab
// live UI. See tool/browser-preview/shim.ts for the `window.castApi` stand-in
// this server's HTML injects, and tool/browser-preview/build.mjs for how both
// files get bundled.
//
// SQLite backs up a read-only source connection into a consistent private
// snapshot, including committed WAL state. Only that destination is opened
// by CastRepository, whose initialization performs migrations and PRAGMAs.
// The private database is closed and removed after materializing the snapshot.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { backup, DatabaseSync, type BackupOptions } from 'node:sqlite';
import { CastRepository, createTestRepository } from '@lumacast/persistence-sqlite';
import { ManagedMediaRegistry, managedMediaUrl, looksLikeManagedMediaReference, maskAppSnapshot, resolveManagedMedia, type ManagedMediaUse } from '../../apps/cast/main/media-capability';
import { getMediaLibraryDirectory, setMediaLibraryDirectory, mediaLibraryFileName } from '../../apps/cast/main/media-source-path';
import type { AppSnapshot } from '@lumacast/protocol';

const APP_NAME = 'LumaCast';
const DEFAULT_PORT = 4318;
// out/tool/server.js sits next to out/tool/browser-shim.js (both written by
// build.mjs) at the workspace root; the served renderer is Cast's own build
// output at apps/cast/out/renderer (from `npm run build:cast`).
const RENDERER_ROOT = path.resolve(__dirname, '../../apps/cast/out/renderer');
const SHIM_PATH = path.join(__dirname, 'browser-shim.js');

interface CliOptions {
  port: number;
  dbPath: string | null;
  userDataDir: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { port: DEFAULT_PORT, dbPath: null, userDataDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port' && argv[index + 1]) {
      const parsed = Number(argv[++index]);
      if (Number.isFinite(parsed) && parsed > 0) options.port = parsed;
    } else if (arg === '--db' && argv[index + 1]) {
      options.dbPath = path.resolve(argv[++index]);
    } else if (arg === '--user-data-dir' && argv[index + 1]) {
      options.userDataDir = path.resolve(argv[++index]);
    }
  }
  return options;
}

// Mirrors Electron's default `app.getPath('userData')` for the productName
// apps/cast/main/index.ts forces via `app.setName('LumaCast')`. There is no
// Electron process to ask here, so the per-platform default is reimplemented
// directly; `--user-data-dir` overrides it exactly like the real app's own
// CLI flag of the same name.
function defaultUserDataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', APP_NAME);
    case 'win32':
      return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), APP_NAME);
    default:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), APP_NAME);
  }
}

/** Uses SQLite's online backup API rather than racing separate DB/WAL file copies. */
export async function createBrowserPreviewDatabaseSnapshot(dbPath: string, options?: BackupOptions) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-browser-preview-'));
  const destination = path.join(tempDir, 'snapshot.sqlite');
  try {
    const source = new DatabaseSync(dbPath, { readOnly: true, timeout: 5_000 });
    try { await backup(source, destination, options ?? {}); }
    finally { source.close(); }
    return { dbPath: destination, cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }) };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function readBrowserPreviewSnapshot(dbPath: string, userDataPath: string): Promise<AppSnapshot> {
  const temporary = await createBrowserPreviewDatabaseSnapshot(dbPath);
  let repository: CastRepository | undefined;
  try {
    repository = new CastRepository({
      dbPath: temporary.dbPath, userDataPath,
      documentsPath: path.join(path.dirname(temporary.dbPath), 'documents'),
    });
    return repository.getSnapshot();
  } finally {
    try { repository?.close(); }
    finally { temporary.cleanup(); }
  }
}

async function loadSnapshot(options: CliOptions): Promise<AppSnapshot> {
  const userDataPath = options.userDataDir ?? defaultUserDataDir();
  const dbPath = options.dbPath ?? path.join(userDataPath, 'lumacast.sqlite');

  if (!fs.existsSync(dbPath)) {
    console.log(`[browser-preview] no database found at ${dbPath}`);
    console.log('[browser-preview] serving a fresh, empty project instead (pass --db <path> to point at a real one)');
    const fixture = createTestRepository({ seed: true });
    try { return fixture.repository.getSnapshot(); }
    finally { fixture.close(); fixture.cleanup(); }
  }

  console.log(`[browser-preview] reading a consistent snapshot of ${dbPath}`);
  return readBrowserPreviewSnapshot(dbPath, userDataPath);
}

// ─── Static asset + index.html serving ──────────────────────────────────────

const CONTENT_TYPES = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.wasm', 'application/wasm'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const CAST_MEDIA_DIRECTIVES = new Set(['img-src', 'media-src', 'connect-src', 'script-src']);

/** Adds this server's own origin to the CSP directives that need it, leaving
 * every other directive (and the Electron app's own shipped index.html)
 * untouched — this mutation happens only in the HTTP response, never on disk.
 */
function rewriteCsp(html: string, origin: string): string {
  return html.replace(
    /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/,
    (_whole, prefix: string, content: string, suffix: string) => {
      const rewritten = content
        .split(';')
        .map((rawDirective) => {
          const directive = rawDirective.trim();
          if (!directive) return directive;
          const name = directive.split(/\s+/, 1)[0];
          if (CAST_MEDIA_DIRECTIVES.has(name) && !directive.includes(origin)) {
            return `${directive} ${origin}`;
          }
          return directive;
        })
        .join('; ');
      return `${prefix}${rewritten}${suffix}`;
    },
  );
}

/** Injects the classic shim script ahead of the renderer's `type="module"`
 * entry point, so `window.castApi` exists before that module graph
 * evaluates (see tool/browser-preview/shim.ts's header comment for why).
 */
function injectShim(html: string): string {
  if (!html.includes('<script src="/__browser-shim.js">')) {
    html = html.replace(
      /<script\s+type="module"/,
      '<script src="/__browser-shim.js"></script>\n    <script type="module"',
    );
  }
  return html;
}

function serveIndexHtml(req: http.IncomingMessage, res: http.ServerResponse, rendererRoot: string): void {
  const indexPath = resolveStaticPath(rendererRoot, '/index.html');
  if (!indexPath) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(indexPath, 'utf8', (error, html) => {
    if (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Renderer build not found. Run `npm run build:cast` first.');
      return;
    }
    const origin = `http://${req.headers.host}`;
    const rewritten = rewriteCsp(injectShim(html), origin);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(rewritten);
  });
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveStaticPath(rendererRoot: string, pathname: string): string | null {
  const candidate = path.normalize(path.join(rendererRoot, pathname));
  if (!isWithin(rendererRoot, candidate)) return null;
  try {
    const canonical = fs.realpathSync(candidate);
    return isWithin(rendererRoot, canonical) ? canonical : null;
  } catch (error) {
    // Missing routes still reach the SPA fallback; existing symlinks must stay inside the root.
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? candidate : null;
  }
}

function serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, rendererRoot: string): void {
  const filePath = resolveStaticPath(rendererRoot, pathname);
  if (!filePath) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      // SPA fallback: an extensionless path that isn't a real file is a
      // client route, not a missing asset — serve index.html for it. A path
      // with a dot in its last segment (a `.js`/`.png`/... request) is a
      // genuine missing-asset 404, not a route.
      const basename = path.basename(pathname.split('?')[0] ?? '');
      if (error.code === 'ENOENT' && !basename.includes('.')) {
        serveIndexHtml(req, res, rendererRoot);
        return;
      }
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    res.writeHead(200, {
      'content-type': CONTENT_TYPES.get(path.extname(filePath)) ?? 'application/octet-stream',
    });
    res.end(data);
  });
}

// ─── /cast-media/<id> streaming, with Range support ─────────────────────────

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
  if (fileSize === 0) return null;
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

function intendedUseFromRequest(req: http.IncomingMessage): ManagedMediaUse | null {
  const destination = req.headers['sec-fetch-dest'];
  if (destination === 'image' || destination === 'video' || destination === 'audio') return destination;
  return null;
}

function serveCastMedia(req: http.IncomingMessage, res: http.ServerResponse, id: string, registry: ManagedMediaRegistry): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }

  const resolution = registry.resolve(`cast-media://${id}`, intendedUseFromRequest(req));
  if (!resolution.ok) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Not found (${resolution.reason})`);
    return;
  }

  let size: number;
  try {
    size = fs.statSync(resolution.filePath).size;
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found (file missing)');
    return;
  }

  const contentType = guessContentType(resolution.filePath);
  const range = req.headers.range;

  if (typeof range === 'string') {
    const parsed = parseSingleByteRange(range, size);
    if (!parsed) {
      res.writeHead(416, {
        'accept-ranges': 'bytes',
        'content-range': `bytes */${size}`,
        'content-type': contentType,
        'cache-control': 'no-store',
      });
      res.end();
      return;
    }

    const { start, end } = parsed;
    const headers = {
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-type': contentType,
      'cache-control': 'no-store',
    };
    res.writeHead(206, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    pipeline(fs.createReadStream(resolution.filePath, { start, end }), res, () => {});
    return;
  }

  const headers = {
    'accept-ranges': 'bytes',
    'content-length': String(size),
    'content-type': contentType,
    'cache-control': 'no-store',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  pipeline(fs.createReadStream(resolution.filePath), res, () => {});
}

// ─── Boot ────────────────────────────────────────────────────────────────

export interface BrowserPreviewOptions {
  rendererRoot: string;
  shimPath: string;
  snapshot: AppSnapshot;
  mediaLibraryDirectory: string | null;
  port?: number;
}

function maskPreviewSnapshot(snapshot: AppSnapshot, libraryDirectory: string | null, registry: ManagedMediaRegistry): AppSnapshot {
  const previousDirectory = getMediaLibraryDirectory();
  let masked: AppSnapshot;
  try {
    setMediaLibraryDirectory(libraryDirectory);
    masked = maskAppSnapshot(snapshot);
  } finally { setMediaLibraryDirectory(previousDirectory); }

  // Reuse the app's field-aware masking, but give each preview its own grants.
  // Comparing the two trees avoids interpreting media-looking text as a file grant.
  const reissue = (value: unknown, original: unknown): unknown => {
    if (value === original) return value;
    if (typeof value === 'string' && looksLikeManagedMediaReference(value)) {
      const grant = resolveManagedMedia(value);
      if (!grant.ok) return '';
      const libraryFile = mediaLibraryFileName(grant.source);
      const filePath = libraryFile && libraryDirectory ? path.join(libraryDirectory, libraryFile) : grant.filePath;
      const id = registry.grant(filePath, grant.use);
      return id ? managedMediaUrl(id) : '';
    }
    if (Array.isArray(value)) return value.map((child, index) => reissue(child, Array.isArray(original) ? original[index] : undefined));
    if (value && typeof value === 'object') {
      const source = original && typeof original === 'object' ? original as Record<string, unknown> : {};
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, reissue(child, source[key])]));
    }
    return value;
  };
  return reissue(masked, snapshot) as AppSnapshot;
}

export function previewOriginForHost(host: string | undefined, port: number): string | null {
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}` ||
      (port === 80 && (host === '127.0.0.1' || host === 'localhost'))) {
    return `http://${port === 80 ? host.replace(/:80$/, '') : host}`;
  }
  return null;
}

/** Starts only on IPv4 loopback. Callers supply the snapshot and asset paths explicitly. */
export async function startBrowserPreviewServer(options: BrowserPreviewOptions): Promise<http.Server> {
  const rendererRoot = fs.realpathSync(options.rendererRoot);
  const registry = new ManagedMediaRegistry();
  const snapshotJson = JSON.stringify(maskPreviewSnapshot(options.snapshot, options.mediaLibraryDirectory, registry));
  const server = http.createServer((req, res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const host = req.headers.host;
    const hostHeaders = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host');
    const expectedOrigin = previewOriginForHost(host, port);
    if (hostHeaders.length !== 1 || !expectedOrigin) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    const normalizedOrigin = typeof origin === 'string' && port === 80 ? origin.replace(/:80$/, '') : origin;
    if ((origin !== undefined && normalizedOrigin !== expectedOrigin) ||
        (site !== undefined && site !== 'same-origin' && site !== 'none')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
      if (!pathname.startsWith('/') || pathname.startsWith('//') || /[\u0000-\u001f\u007f\\]/.test(pathname)) throw new Error('Invalid path');
    } catch {
      res.writeHead(400).end('Invalid request path');
      return;
    }
    if (pathname === '/snapshot') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(snapshotJson);
      return;
    }
    if (pathname === '/__browser-shim.js') {
      fs.readFile(options.shimPath, (error, data) => {
        if (error) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Browser preview shim not found.');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }).end(data);
      });
      return;
    }
    const media = /^\/cast-media\/([^/]+)$/.exec(pathname);
    if (media) {
      serveCastMedia(req, res, media[1], registry);
      return;
    }
    if (pathname === '/') serveIndexHtml(req, res, rendererRoot);
    else serveStaticFile(req, res, pathname, rendererRoot);
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_PORT, '127.0.0.1', resolve);
  });
  return server;
}

export async function runBrowserPreviewCli(): Promise<void> {
  if (!fs.existsSync(path.join(RENDERER_ROOT, 'index.html'))) {
    console.error(`[browser-preview] renderer build not found at ${RENDERER_ROOT}`);
    console.error('[browser-preview] run `npm run build:cast` first');
    process.exit(1);
  }

  const options = parseArgs(process.argv.slice(2));
  const snapshot = await loadSnapshot(options);
  // Computed once at startup: this is a point-in-time, read-only preview, not
  // a live view, and managed media ids are stable for the life of this
  // process (media-capability.ts's registry key is (use, source), reused on
  // repeat grants) — recomputing per request would only re-derive the same
  // JSON at extra cost.
  const server = await startBrowserPreviewServer({
    rendererRoot: RENDERER_ROOT, shimPath: SHIM_PATH,
    snapshot, port: options.port,
    mediaLibraryDirectory: path.join(options.userDataDir ?? defaultUserDataDir(), 'media'),
  });
  console.log(`\n  ➜  LumaCast browser preview:  http://127.0.0.1:${options.port}/\n`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.closeAllConnections();
      server.close(() => process.exit(0));
    });
  }
}
