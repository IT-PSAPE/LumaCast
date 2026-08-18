// `npm run preview:browser`: serves the built renderer (out/renderer, from
// `npm run build`) to a plain Chrome browser instead of Electron, with the
// user's REAL project data, read-only, so a design-capture extension can grab
// live UI. See tool/browser-preview/shim.ts for the `window.castApi` stand-in
// this server's HTML injects, and tool/browser-preview/build.mjs for how both
// files get bundled.
//
// Read-only by construction: the resolved database (+ -wal/-shm siblings, if
// present) is copied to a fresh temp directory once at startup, and
// CastRepository opens that COPY — never the original file. CastRepository's
// constructor always runs `PRAGMA journal_mode=WAL` and friends on open
// (packages/persistence-sqlite/src/store.ts's `applyConnectionTuning`), which
// are writes even absent any application-level mutation; node:sqlite's
// `readOnly` flag would reject exactly those pragma writes. Copy-then-open-
// normally is therefore the option that is both genuinely non-destructive to
// the user's real database and compatible with `CastRepository` exactly as
// written, without forking persistence-sqlite to plumb a `readOnly` option
// through its constructor.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { CastRepository, createTestRepository } from '@lumacast/persistence-sqlite';
import { maskAppSnapshot, resolveManagedMedia, type ManagedMediaUse } from '../../app/main/media-capability';

const APP_NAME = 'LumaCast';
const DEFAULT_PORT = 4318;
// out/tool/server.js sits next to out/tool/browser-shim.js (both written by
// build.mjs) and one level below out/renderer (from `npm run build`).
const RENDERER_ROOT = path.resolve(__dirname, '../renderer');
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
// app/main/index.ts forces via `app.setName('LumaCast')`. There is no
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

// Mirrors app/main/index.ts: `path.join(app.getPath('documents'), APP_NAME)`.
function defaultDocumentsDir(): string {
  return path.join(os.homedir(), 'Documents', APP_NAME);
}

function copyIfExists(src: string, dest: string): void {
  if (fs.existsSync(src)) fs.copyFileSync(src, dest);
}

/**
 * Copies the database file plus its `-wal`/`-shm` siblings (if present) into
 * a fresh temp directory, so `CastRepository` opens a private, writable copy
 * and the user's real database file is never touched.
 */
function copyDatabaseToTemp(dbPath: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-browser-preview-'));
  const destDbPath = path.join(tempDir, path.basename(dbPath));
  fs.copyFileSync(dbPath, destDbPath);
  copyIfExists(`${dbPath}-wal`, `${destDbPath}-wal`);
  copyIfExists(`${dbPath}-shm`, `${destDbPath}-shm`);
  return destDbPath;
}

function buildRepository(options: CliOptions): CastRepository {
  const userDataPath = options.userDataDir ?? defaultUserDataDir();
  const documentsPath = defaultDocumentsDir();
  const dbPath = options.dbPath ?? path.join(userDataPath, 'lumacast.sqlite');

  if (!fs.existsSync(dbPath)) {
    console.log(`[browser-preview] no database found at ${dbPath}`);
    console.log('[browser-preview] serving a fresh, empty project instead (pass --db <path> to point at a real one)');
    return createTestRepository({ seed: true }).repository;
  }

  console.log(`[browser-preview] reading a temp copy of ${dbPath}`);
  const tempDbPath = copyDatabaseToTemp(dbPath);
  try {
    fs.mkdirSync(documentsPath, { recursive: true });
  } catch {
    // Non-fatal: nothing reachable in this read-only preview touches the
    // documents directory.
  }
  return new CastRepository({ dbPath: tempDbPath, userDataPath, documentsPath });
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

function serveIndexHtml(req: http.IncomingMessage, res: http.ServerResponse): void {
  fs.readFile(path.join(RENDERER_ROOT, 'index.html'), 'utf8', (error, html) => {
    if (error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Renderer build not found. Run `npm run build` first.');
      return;
    }
    const host = req.headers.host ?? `localhost:${DEFAULT_PORT}`;
    const origin = `http://${host}`;
    const rewritten = rewriteCsp(injectShim(html), origin);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(rewritten);
  });
}

function resolveStaticPath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname.split('?')[0] ?? '/');
  const candidate = path.normalize(path.join(RENDERER_ROOT, decoded));
  if (!candidate.startsWith(RENDERER_ROOT)) return null;
  return candidate;
}

function serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
  const filePath = resolveStaticPath(pathname);
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
        serveIndexHtml(req, res);
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

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'accept-ranges, content-length, content-range, content-type',
} as const;

function intendedUseFromRequest(req: http.IncomingMessage): ManagedMediaUse | null {
  const destination = req.headers['sec-fetch-dest'];
  if (destination === 'image' || destination === 'video' || destination === 'audio') return destination;
  return null;
}

function serveCastMedia(req: http.IncomingMessage, res: http.ServerResponse, id: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...CORS_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }

  const resolution = resolveManagedMedia(`cast-media://${id}`, intendedUseFromRequest(req));
  if (!resolution.ok) {
    res.writeHead(404, { ...CORS_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Not found (${resolution.reason})`);
    return;
  }

  let size: number;
  try {
    size = fs.statSync(resolution.filePath).size;
  } catch {
    res.writeHead(404, { ...CORS_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found (file missing)');
    return;
  }

  const contentType = guessContentType(resolution.filePath);
  const range = req.headers.range;

  if (typeof range === 'string') {
    const parsed = parseSingleByteRange(range, size);
    if (!parsed) {
      res.writeHead(416, {
        ...CORS_HEADERS,
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
      ...CORS_HEADERS,
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
    fs.createReadStream(resolution.filePath, { start, end }).pipe(res);
    return;
  }

  const headers = {
    ...CORS_HEADERS,
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
  fs.createReadStream(resolution.filePath).pipe(res);
}

// ─── Boot ────────────────────────────────────────────────────────────────

function main(): void {
  if (!fs.existsSync(path.join(RENDERER_ROOT, 'index.html'))) {
    console.error(`[browser-preview] renderer build not found at ${RENDERER_ROOT}`);
    console.error('[browser-preview] run `npm run build` first');
    process.exit(1);
  }

  const options = parseArgs(process.argv.slice(2));
  const repository = buildRepository(options);
  // Computed once at startup: this is a point-in-time, read-only preview, not
  // a live view, and managed media ids are stable for the life of this
  // process (media-capability.ts's registry key is (use, source), reused on
  // repeat grants) — recomputing per request would only re-derive the same
  // JSON at extra cost.
  const snapshotJson = JSON.stringify(maskAppSnapshot(repository.getSnapshot()));

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';

    if (pathname === '/snapshot') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(snapshotJson);
      return;
    }

    if (pathname === '/__browser-shim.js') {
      fs.readFile(SHIM_PATH, (error, data) => {
        if (error) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('browser-shim.js not built. Run `npm run preview:browser` (not the server directly).');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        res.end(data);
      });
      return;
    }

    const castMediaMatch = /^\/cast-media\/([^/]+)$/.exec(pathname);
    if (castMediaMatch) {
      serveCastMedia(req, res, castMediaMatch[1]!);
      return;
    }

    if (pathname === '/') {
      serveIndexHtml(req, res);
      return;
    }

    serveStaticFile(req, res, pathname);
  });

  server.listen(options.port, () => {
    console.log('');
    console.log(`  ➜  LumaCast browser preview:  http://localhost:${options.port}/`);
    console.log('');
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

main();
