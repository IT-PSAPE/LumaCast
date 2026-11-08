// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { createTestRepository } from '../../packages/persistence-sqlite/src/test-support';
import { createBrowserPreviewDatabaseSnapshot, readBrowserPreviewSnapshot, previewOriginForHost, startBrowserPreviewServer } from '../../tool/browser-preview/server';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture() {
  const handle = createTestRepository({ seed: false });
  let server: import('node:http').Server | undefined;
  cleanup.push(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    handle.close(); handle.cleanup();
  });
  const root = handle.paths.root;
  const rendererRoot = path.join(root, 'renderer');
  fs.mkdirSync(rendererRoot);
  fs.writeFileSync(path.join(rendererRoot, 'index.html'), '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; img-src \'self\'; script-src \'self\'"></head><body><script type="module" src="/app.js"></script></body></html>');
  fs.writeFileSync(path.join(rendererRoot, 'app.js'), 'window.previewFixture = true;');
  const shimPath = path.join(root, 'shim.js');
  fs.writeFileSync(shimPath, 'window.castApi = {};');
  const imagePath = path.join(root, 'sample.png');
  await sharp({ create: { width: 8, height: 4, channels: 3, background: 'red' } }).png().toFile(imagePath);
  handle.repository.createMediaAsset({ name: 'Synthetic private image', type: 'image', src: `cast-media://${encodeURIComponent(imagePath)}` });
  const libraryDirectory = path.join(root, 'media');
  fs.mkdirSync(libraryDirectory);
  const libraryFile = `${createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex')}.png`;
  fs.copyFileSync(imagePath, path.join(libraryDirectory, libraryFile));
  handle.repository.createMediaAsset({ name: 'Synthetic library image', type: 'image', src: `cast-media://library/${libraryFile}` });
  const emptyFile = path.join(root, 'empty.png');
  fs.writeFileSync(emptyFile, '');
  handle.repository.createMediaAsset({ name: 'Synthetic empty image', type: 'image', src: `cast-media://${encodeURIComponent(emptyFile)}` });
  const snapshot = await readBrowserPreviewSnapshot(handle.paths.dbPath, root);
  server = await startBrowserPreviewServer({ rendererRoot, shimPath, snapshot, mediaLibraryDirectory: libraryDirectory, port: 0 });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  const url = `http://127.0.0.1:${address.port}`;
  return { server, url, root, rendererRoot, imagePath, dbPath: handle.paths.dbPath };
}

function raw(url: string, requestPath: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = request(url, { path: requestPath, headers, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
}

async function mediaPath(url: string) {
  const response = await fetch(`${url}/snapshot`);
  const snapshot = await response.json();
  return snapshot.mediaAssets[0].src.replace('cast-media://', '/cast-media/') as string;
}

describe('browser preview boundary', () => {
  it('binds only IPv4 loopback and accepts exact same-origin and headerless local reads', async () => {
    const { server, url } = await fixture();
    expect((server.address() as { address: string }).address).toBe('127.0.0.1');
    expect((await raw(url, '/snapshot')).status).toBe(200);
    const response = await raw(url, '/snapshot', { Origin: url, 'Sec-Fetch-Site': 'same-origin' });
    expect(response.status).toBe(200);
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect((await raw(url, '/', { 'Sec-Fetch-Site': 'none' })).status).toBe(200);
  });

  it('rejects Host aliases, foreign origins and fetch sites on every data route', async () => {
    const { url } = await fixture();
    const media = await mediaPath(url);
    const port = new URL(url).port;
    const rejectedHeaders: Array<Record<string, string>> = [
        { Host: `attacker.example:${port}` }, { Host: `127.0.0.1:${Number(port) + 1}` },
        { Host: `127.0.0.1.:${port}` }, { Host: `2130706433:${port}` },
        { Origin: 'null' }, { Origin: 'https://attacker.example' }, { Origin: `${url}/` },
        { Origin: `http://localhost:${port}` }, { 'Sec-Fetch-Site': 'cross-site' },
        { 'Sec-Fetch-Site': 'same-site' },
    ];
    for (const pathname of ['/', '/snapshot', '/app.js', '/__browser-shim.js', media]) {
      for (const headers of rejectedHeaders) {
        const response = await raw(url, pathname, headers);
        expect(response.status, `${pathname} ${JSON.stringify(headers)}`).toBe(403);
        expect(response.body.toString()).not.toContain('Synthetic private image');
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      }
    }
    expect((await raw(url, '/snapshot', { Host: `localhost:${port}`, Origin: `http://localhost:${port}` })).status).toBe(200);
  });

  it('allows GET/HEAD only, preserving HTML/shim, SPA and byte-range behavior', async () => {
    const { url, imagePath } = await fixture();
    const media = await mediaPath(url);
    for (const pathname of ['/', '/snapshot', '/app.js', '/__browser-shim.js', media]) {
      for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
        const response = await raw(url, pathname, {}, method);
        expect(response.status).toBe(405);
        expect(response.headers.allow).toBe('GET, HEAD');
      }
      const head = await raw(url, pathname, {}, 'HEAD');
      expect(head.status).toBe(200); expect(head.body).toHaveLength(0);
    }
    const html = await raw(url, '/workbench');
    expect(html.status).toBe(200);
    expect(html.body.toString()).toContain('<script src="/__browser-shim.js"></script>');
    expect(html.body.toString()).toContain(`img-src 'self' ${url}`);
    const full = fs.readFileSync(imagePath);
    const ranged = await raw(url, media, { Range: 'bytes=2-7' });
    expect(ranged.status).toBe(206); expect(ranged.body).toEqual(full.subarray(2, 8));
    expect(ranged.headers['content-range']).toBe(`bytes 2-7/${full.length}`);
    const rangedHead = await raw(url, media, { Range: 'bytes=-4' }, 'HEAD');
    expect(rangedHead.status).toBe(206); expect(rangedHead.body).toHaveLength(0);
    expect((await raw(url, media, { Range: 'bytes=999999-' })).status).toBe(416);
    const snapshot = await (await fetch(`${url}/snapshot`)).json();
    const empty = snapshot.mediaAssets.find((asset: { name: string }) => asset.name === 'Synthetic empty image').src.replace('cast-media://', '/cast-media/');
    const emptyRange = await raw(url, empty, { Range: 'bytes=-1' });
    expect(emptyRange.status).toBe(416);
    expect(emptyRange.headers['content-range']).toBe('bytes */0');
    expect((await raw(url, '/missing.js')).status).toBe(404);
  });

  it('serves modern library media through private capabilities owned by each preview', async () => {
    const first = await fixture();
    const second = await fixture();
    const snapshot = await (await fetch(`${first.url}/snapshot`)).json();
    const library = snapshot.mediaAssets.find((asset: { name: string }) => asset.name === 'Synthetic library image');
    expect(library.src).toMatch(/^cast-media:\/\/m[0-9a-f]{32}$/);
    const requestPath = library.src.replace('cast-media://', '/cast-media/');
    expect((await raw(first.url, requestPath)).body).toEqual(fs.readFileSync(first.imagePath));
    expect((await raw(second.url, requestPath)).status).toBe(404);
    expect((await raw(first.url, requestPath, { 'Sec-Fetch-Dest': 'audio' })).status).toBe(404);
    fs.unlinkSync(path.join(first.root, 'media', fs.readdirSync(path.join(first.root, 'media'))[0]));
    const secondSnapshot = await (await fetch(`${second.url}/snapshot`)).json();
    const secondLibrary = secondSnapshot.mediaAssets.find((asset: { name: string }) => asset.name === 'Synthetic library image');
    const secondPath = secondLibrary.src.replace('cast-media://', '/cast-media/');
    expect((await raw(second.url, secondPath)).body).toEqual(fs.readFileSync(second.imagePath));
  });

  it('rejects malformed paths, prefix siblings and escaping symlinks without losing availability', async () => {
    const { url, root, rendererRoot } = await fixture();
    const sibling = `${rendererRoot}-secret`;
    fs.mkdirSync(sibling); fs.writeFileSync(path.join(sibling, 'secret.txt'), 'outside private data');
    fs.symlinkSync(sibling, path.join(rendererRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const requestPath of ['/%', '/%00', '/%5csecret', '//attacker.example/x', '/../renderer-secret/secret.txt', '/%2e%2e/renderer-secret/secret.txt', '/escape/secret.txt']) {
      const response = await raw(url, requestPath);
      expect([400, 403]).toContain(response.status);
      expect(response.body.toString()).not.toContain('outside private data');
    }
    expect((await raw(url, '/snapshot')).status).toBe(200);
    expect(fs.existsSync(path.join(root, 'documents'))).toBe(false);
  });

  it('handles HTTP default-port spelling without accepting hostname aliases', () => {
    expect(previewOriginForHost('127.0.0.1', 80)).toBe('http://127.0.0.1');
    expect(previewOriginForHost('127.0.0.1:80', 80)).toBe('http://127.0.0.1');
    expect(previewOriginForHost('localhost', 80)).toBe('http://localhost');
    expect(previewOriginForHost('localhost:80', 80)).toBe('http://localhost');
    for (const host of ['127.1:80', 'localhost.:80', '127.0.0.1:0080', 'LOCALHOST:80']) {
      expect(previewOriginForHost(host, 80)).toBeNull();
    }
    expect(previewOriginForHost('127.0.0.1', 4318)).toBeNull();
  });
});

describe('consistent private preview database', () => {
  function sourceDatabase() {
    const handle = createTestRepository({ seed: false });
    const source = new DatabaseSync(handle.paths.dbPath);
    source.exec('PRAGMA wal_autocheckpoint=0; CREATE TABLE preview_fixture(id INTEGER PRIMARY KEY, value TEXT);');
    const insert = source.prepare('INSERT INTO preview_fixture VALUES (?, ?)');
    for (let id = 1; id <= 128; id++) insert.run(id, 'x'.repeat(4096));
    cleanup.push(async () => { source.close(); handle.close(); handle.cleanup(); });
    return { handle, source };
  }

  it('includes committed WAL data without changing source DB or WAL', async () => {
    const { handle, source } = sourceDatabase();
    const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before = [hash(handle.paths.dbPath), hash(`${handle.paths.dbPath}-wal`)];
    const copy = await createBrowserPreviewDatabaseSnapshot(handle.paths.dbPath);
    const destination = new DatabaseSync(copy.dbPath, { readOnly: true });
    try {
      expect(destination.prepare('SELECT COUNT(*) AS n FROM preview_fixture').get()?.n).toBe(128);
      expect(destination.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      expect([hash(handle.paths.dbPath), hash(`${handle.paths.dbPath}-wal`)]).toEqual(before);
      expect(source.prepare('SELECT COUNT(*) AS n FROM preview_fixture').get()?.n).toBe(128);
    } finally { destination.close(); copy.cleanup(); }
    expect(fs.existsSync(path.dirname(copy.dbPath))).toBe(false);
    await readBrowserPreviewSnapshot(handle.paths.dbPath, handle.paths.root);
    expect([hash(handle.paths.dbPath), hash(`${handle.paths.dbPath}-wal`)]).toEqual(before);
  });

  it('remains consistent when a writer commits and checkpoints between backup steps', async () => {
    const { handle, source } = sourceDatabase();
    let checkpointed = false;
    const copy = await createBrowserPreviewDatabaseSnapshot(handle.paths.dbPath, {
      rate: 1,
      progress: () => {
        if (checkpointed) return;
        source.exec("INSERT INTO preview_fixture VALUES(129, 'committed during backup'); PRAGMA wal_checkpoint(TRUNCATE)");
        checkpointed = true;
      },
    });
    const destination = new DatabaseSync(copy.dbPath, { readOnly: true });
    try {
      expect(checkpointed).toBe(true);
      expect(destination.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      expect(destination.prepare('SELECT COUNT(*) AS n FROM preview_fixture WHERE id<=128').get()?.n).toBe(128);
      expect(source.prepare('SELECT COUNT(*) AS n FROM preview_fixture').get()?.n).toBe(129);
    } finally { destination.close(); copy.cleanup(); }
  });

  it('closes the read-only source and removes partial private output on backup failure', async () => {
    const { handle, source } = sourceDatabase();
    const temporary = vi.spyOn(fs, 'mkdtempSync');
    await expect(createBrowserPreviewDatabaseSnapshot(handle.paths.dbPath, { source: 'missing_database' })).rejects.toThrow();
    const directory = temporary.mock.results[0].value as string;
    expect(fs.existsSync(directory)).toBe(false);
    const missing = path.join(handle.paths.root, 'missing.sqlite');
    await expect(createBrowserPreviewDatabaseSnapshot(missing)).rejects.toThrow();
    expect(fs.existsSync(missing)).toBe(false);
    await expect(createBrowserPreviewDatabaseSnapshot(handle.paths.dbPath, {
      rate: 1, progress: () => { throw new Error('Synthetic backup interruption'); },
    })).rejects.toThrow('Synthetic backup interruption');
    expect(source.prepare('SELECT COUNT(*) AS n FROM preview_fixture').get()?.n).toBe(128);
    await expect(readBrowserPreviewSnapshot(handle.paths.dbPath, handle.paths.root)).resolves.toHaveProperty('mediaAssets');
    for (const result of temporary.mock.results) expect(fs.existsSync(result.value as string)).toBe(false);
  });
});
