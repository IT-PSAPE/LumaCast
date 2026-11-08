// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);

describe('shared Vite toolchain', () => {
  it('resolves root, all apps and Vitest to the same patched Vite', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const expected = manifest.devDependencies.vite;
    expect(expected).toBe('6.4.5');
    expect(manifest.overrides.vite).toBe('$vite');
    const resolved = require.resolve('vite/package.json');
    for (const app of ['cast', 'cloud', 'flux', 'chord', 'soundboard', 'stream']) {
      const appManifest = path.join(ROOT, 'apps', app, 'package.json');
      expect(JSON.parse(fs.readFileSync(appManifest, 'utf8')).devDependencies.vite).toBe(expected);
      expect(createRequire(appManifest).resolve('vite/package.json')).toBe(resolved);
    }
    expect(createRequire(require.resolve('vitest/package.json')).resolve('vite/package.json')).toBe(resolved);
    expect(JSON.parse(fs.readFileSync(resolved, 'utf8')).version).toBe(expected);
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const viteEntries = Object.entries(lock.packages).filter(([location]) => location.endsWith('node_modules/vite'));
    expect(viteEntries).toEqual([['node_modules/vite', expect.objectContaining({ version: expected })]]);
    expect(require('vitest/package.json').version).toBe(manifest.devDependencies.vitest);
    expect(require('@vitest/mocker/package.json').version).toBe(manifest.devDependencies.vitest);
  });

  it('retains the Stream wrapper CommonJS loadEnv API with an explicit synthetic directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-vite-env-'));
    try {
      fs.writeFileSync(path.join(dir, '.env'), 'LUMACAST_SYNTHETIC_BASE=base\n');
      fs.writeFileSync(path.join(dir, '.env.test'), 'LUMACAST_SYNTHETIC_VALUE=test\n');
      const script = 'const {loadEnv}=require(process.argv[1]); console.log(JSON.stringify(loadEnv("test",process.cwd(),"LUMACAST_SYNTHETIC_")))';
      const result = execFileSync(process.execPath, ['-e', script, require.resolve('vite')], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, VITE_CJS_IGNORE_WARNING: 'true' }, timeout: 5_000,
      });
      expect(JSON.parse(result)).toEqual({ LUMACAST_SYNTHETIC_BASE: 'base', LUMACAST_SYNTHETIC_VALUE: 'test' });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // The shadow-path advisory affects non-Windows URL/filesystem paths.
  it.skipIf(process.platform === 'win32')('denies outside shadow paths and denied in-root files even with transform queries', async () => {
    const { createServer } = await import('vite');
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-vite-boundary-')));
    const root = path.join(dir, 'project');
    const outside = path.join(dir, 'outside.js');
    const shadow = path.join(root, outside.slice(1));
    fs.mkdirSync(path.dirname(shadow), { recursive: true });
    fs.writeFileSync(outside, 'export default "OWNED_OUTSIDE_SENTINEL"');
    fs.writeFileSync(shadow, 'export default "OWNED_INSIDE_SHADOW"');
    fs.writeFileSync(path.join(root, 'main.js'), `import shadow from ${JSON.stringify(`./${outside.slice(1)}`)}; console.log(shadow)`);
    fs.writeFileSync(path.join(root, '.env'), 'OWNED_PRIVATE=DENIED_SYNTHETIC_SENTINEL\n');
    const reservation = net.createServer();
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
    const port = (reservation.address() as net.AddressInfo).port;
    await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    const server = await createServer({ configFile: false, root, envDir: root, cacheDir: path.join(dir, 'cache'), logLevel: 'silent',
      server: { host: '127.0.0.1', port, strictPort: true, fs: { strict: true, allow: [root] } },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      await server.listen();
      const base = `http://127.0.0.1:${port}`;
      const get = (url: string) => fetch(`${base}${url}`, { signal: AbortSignal.timeout(5_000) });
      // Analyze the in-root shadow import first: this populated safeModulePaths
      // with the wrong absolute path before the Vite 6 security backport.
      const main = await get('/main.js');
      expect(main.status).toBe(200);
      expect(await main.text()).toContain(outside);
      expect(await (await get(outside)).text()).toContain('OWNED_INSIDE_SHADOW');
      const escaped = await get(`/@fs${outside}`);
      expect(escaped.status).toBe(403);
      expect(await escaped.text()).not.toContain('OWNED_OUTSIDE_SENTINEL');
      for (const query of ['', '?raw', '?import&raw', '?import&url&inline']) {
        for (const file of ['/.env', `/@fs${path.join(root, '.env')}`]) {
          const response = await get(`${file}${query}`);
          expect(response.status, `${file}${query}`).toBe(403);
          expect(await response.text()).not.toContain('DENIED_SYNTHETIC_SENTINEL');
        }
      }
    } finally {
      await server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
