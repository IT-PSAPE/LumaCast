import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';
import { createServer } from 'vite';
import { resolveAppElectron } from '../../../../../../tool/app-electron.mjs';
import { mediaBunnyPatchPlugin, verifyMediaBunnyPatch } from '../../../../../../tool/patch-mediabunny.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../../..');
const output = path.join(root, 'output/playwright/chord-export-synthetic');
const patch = verifyMediaBunnyPatch({ rootDir: root });
const profile = await mkdtemp(path.join(tmpdir(), 'chord-export-proof-'));
const workspacePackages = ['ui', 'kernel', 'composition', 'canvas', 'selection', 'markers', 'desktop'];
let server;
try { server = await createServer({
  configFile: false, root, cacheDir: path.join(profile, 'vite-cache'),
  plugins: [mediaBunnyPatchPlugin({ rootDir: root })],
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: Object.fromEntries(workspacePackages.map((name) => [`@lumacast/${name}`, path.join(root, `packages/${name}/src/index.ts`)])),
    dedupe: ['react', 'react-dom', 'konva', 'react-konva'],
  },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-konva', 'konva', 'zustand', 'zod'] },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [root] } },
}); } catch (error) {
  await rm(profile, { recursive: true, force: true });
  throw error;
}
let app;
try {
  await server.listen();
  const address = server.httpServer.address();
  const audioMode = process.argv.includes('--audio');
  const url = `http://127.0.0.1:${address.port}/tests/apps/chord/renderer/features/export/${audioMode ? 'audio' : 'export'}.fixture.html${process.argv.includes('--trace') ? '?trace=1' : ''}`;
  const env = { ...process.env, CHORD_EXPORT_FIXTURE_URL: url, CHORD_EXPORT_FIXTURE_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const runtime = resolveAppElectron('chord');
  app = await _electron.launch({ executablePath: runtime.binaryPath, args: [path.join(here, 'export.fixture.cjs')], env });
  const page = await app.firstWindow();
  const errors = [];
  let failPage;
  const failedPage = new Promise((_, reject) => { failPage = reject; });
  page.on('pageerror', (error) => { errors.push(error.message); failPage(error); });
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  try { await Promise.race([page.waitForFunction(() => window.__chordExportProof !== undefined, undefined, { timeout: 60_000 }), failedPage]); }
  catch (error) {
    await mkdir(output, { recursive: true });
    const state = await page.evaluate(() => ({ title: document.title, partial: window.__chordExportPartial, resources: performance.getEntriesByType('resource').map((entry) => entry.name) }));
    await writeFile(path.join(output, 'failure.json'), JSON.stringify({ errors, error: String(error), url: page.url(), state }, null, 2));
    throw error;
  }
  const result = await page.evaluate(() => window.__chordExportProof);
  assert.equal(verifyMediaBunnyPatch({ rootDir: root }).fingerprint, patch.fingerprint);
  const sources = [
    'apps/chord/renderer/features/export/export-engine.ts',
    'apps/chord/renderer/features/export/background-frame-source.ts',
    `tests/apps/chord/renderer/features/export/${audioMode ? 'audio' : 'export'}.fixture.ts`,
  ];
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (source) => [source, createHash('sha256').update(await readFile(path.join(root, source))).digest('hex')])));
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, audioMode ? 'audio-results.json' : process.argv.includes('--trace') ? 'trace-results.json' : 'results.json'), JSON.stringify({ ...result, pageErrors: errors, electron: runtime.version, dependencyPatch: { fingerprint: patch.fingerprint, esmEntry: patch.esmEntry }, sourceHashes }, null, 2));
  if (audioMode && result.ok) {
    const controls = Object.fromEntries(['nativeMp3EncoderSupported', 'wav', 'mp3', 'm4a', 'largeWrite'].map((key) => [key, result.observations[key]]));
    await writeFile(path.join(output, 'audio-controls.json'), JSON.stringify({ ok: true, observations: controls, scope: 'Positive audio-only conversions and held/released production8MiB WAV write control.', pageErrors: errors, electron: runtime.version, dependencyPatch: { fingerprint: patch.fingerprint, esmEntry: patch.esmEntry }, sourceHashes }, null, 2));
  }
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(errors, []);
  await rm(path.join(output, 'failure.json'), { force: true });
  if (process.argv.includes('--trace')) {
    console.log(JSON.stringify({ ok: result.ok, scope: result.scope, cases: Object.fromEntries(Object.entries(result.observations).map(([key, value]) => [key, { resources: value.resources, mismatches: value.rows.filter((row) => row.sourceMarker !== row.canvasMarker || row.canvasMarker !== row.encodedMarker || row.encodedMarker !== row.gridOracle) }])) }));
  } else console.log(JSON.stringify(result));
} finally {
  try { await app?.close(); }
  finally {
    try { await server.close(); }
    finally { await rm(profile, { recursive: true, force: true }); }
  }
}
