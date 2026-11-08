// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { parseStableVersion } from '../../tool/release-version.mjs';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as { load(text: string): unknown };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface AppPackaging {
  appDir: string;
  appId: string;
  productName: string;
  linuxIdentity: string;
  feedTag: string;
}

const APPS: AppPackaging[] = [
  { appDir: 'cast', appId: 'com.lumacast.app', productName: 'LumaCast', linuxIdentity: 'lumacast', feedTag: 'cast-feed' },
  { appDir: 'cloud', appId: 'com.lumacast.cloud', productName: 'LumaCloud', linuxIdentity: 'lumacloud', feedTag: 'cloud-feed' },
  { appDir: 'flux', appId: 'app.lumaflux.desktop', productName: 'Lumaflux', linuxIdentity: 'lumaflux', feedTag: 'flux-feed' },
  { appDir: 'chord', appId: 'com.lumacast.chord', productName: 'LumaChord', linuxIdentity: 'lumachord', feedTag: 'chord-feed' },
];

interface BuilderConfig {
  appId: string;
  productName: string;
  publish: { provider: string; url: string };
  linux: { executableName: string };
  deb: { packageName: string; depends?: string[] };
  electronVersion?: string;
}

function readBuilderConfig(appDir: string): BuilderConfig {
  const doc = yaml.load(
    fs.readFileSync(path.join(repoRoot, 'apps', appDir, 'electron-builder.yml'), 'utf8'),
  );
  return doc as BuilderConfig;
}

function readPackageJson(appDir: string): { name: string; version: string; productName?: string; devDependencies: { electron: string } } {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'apps', appDir, 'package.json'), 'utf8'),
  );
}

// The legacy Linux identity is the unscoped npm name the app shipped under
// before the monorepo restructure; deb packages and executables keep it.
const LEGACY_CAST_LINUX_IDENTITY = 'lumacast';

describe('app packaging config', () => {
  it('resolves every pinned Electron runtime to its installed native ABI', async () => {
    const { getAbi } = require('node-abi') as { getAbi(version: string, runtime: string): string };
    const { resolveAppElectron } = await import('../../tool/app-electron.mjs');
    for (const app of ['cast', 'cloud', 'flux', 'chord', 'soundboard', 'stream']) {
      const runtime = resolveAppElectron(app);
      const installedAbi = execFileSync(runtime.binaryPath, ['-p', 'process.versions.modules'], {
        encoding: 'utf8', timeout: 5_000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      }).trim();
      expect(getAbi(runtime.version, 'electron')).toBe(installedAbi);
    }
  });

  it('keeps resolved native rebuild tooling on the root override policy', () => {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
    const expected = rootPackage.overrides['@electron/rebuild'];
    expect(expected).toMatch(/^\d+\.\d+\.\d+$/);
    const resolved = Object.entries(lock.packages)
      .filter(([location]) => location.endsWith('node_modules/@electron/rebuild'))
      .map(([, entry]) => (entry as { version: string }).version);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.every((version) => version === expected)).toBe(true);
  });

  it('generates AppRun without adding empty library or executable search paths', () => {
    const { generateAppRunScript } = require('app-builder-lib/out/targets/appimage/appImageUtil.js');
    const dir = fs.mkdtempSync(path.join(tmpdir(), 'lumacast-apprun-'));
    try {
      const script = path.join(dir, 'AppRun');
      fs.writeFileSync(script, generateAppRunScript({ ExecutableName: 'probe', ProductName: 'Probe', ProductFilename: 'probe' }));
      fs.writeFileSync(path.join(dir, 'probe'), '#!/bin/sh\nprintf \'%s\\n\' "$LD_LIBRARY_PATH" "$PATH" "$GSETTINGS_SCHEMA_DIR"\n', { mode: 0o755 });
      for (const previous of [undefined, '', '/existing/search']) {
        const env: NodeJS.ProcessEnv = { ...process.env, APPDIR: dir };
        for (const key of ['LD_LIBRARY_PATH', 'PATH', 'GSETTINGS_SCHEMA_DIR']) {
          if (previous === undefined) delete env[key];
          else env[key] = previous;
        }
        // Bash supplies its own default PATH when the variable is absent.
        const inheritedPath = execFileSync('/bin/bash', ['-c', 'printf \'%s\' "$PATH"'], { env, encoding: 'utf8' });
        const output = execFileSync('/bin/bash', [script, '--no-sandbox'], { env, encoding: 'utf8', timeout: 5_000 }).trim().split('\n');
        expect(output).toEqual([
          `${dir}/usr/lib${previous ? `:${previous}` : ''}`,
          `${dir}:${dir}/usr/sbin${inheritedPath ? `:${inheritedPath}` : ''}`,
          `${dir}/usr/share/glib-2.0/schemas${previous ? `:${previous}` : ''}`,
        ]);
        for (const searchPath of output) expect(searchPath.split(':')).not.toContain('');
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('keeps all six apps and the explicit Flux builder pin on the same exact runtime', () => {
    const baseline = readPackageJson('cast').devDependencies.electron;
    expect(baseline).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8'));
    for (const app of ['cast', 'cloud', 'flux', 'chord', 'soundboard', 'stream']) {
      expect(readPackageJson(app).devDependencies.electron).toBe(baseline);
      expect(lock.packages[`apps/${app}`].devDependencies.electron).toBe(baseline);
    }
    expect(readBuilderConfig('flux').electronVersion).toBe(baseline);
  });

  it('gives every app a unique appId', () => {
    const appIds = APPS.map((app) => readBuilderConfig(app.appDir).appId);

    expect(new Set(appIds).size).toBe(APPS.length);
    expect(appIds).toEqual(APPS.map((app) => app.appId));
  });

  it('pins a deb-safe linux executable and deb package name per app', () => {
    for (const app of APPS) {
      const config = readBuilderConfig(app.appDir);

      expect(config.linux.executableName).toBe(app.linuxIdentity);
      expect(config.deb.packageName).toBe(app.linuxIdentity);
      expect(app.linuxIdentity).toMatch(/^[a-z0-9][a-z0-9+.-]*$/);
    }
  });

  it('installs the Cast native GPU libraries alongside Electron runtime dependencies', () => {
    expect(readBuilderConfig('cast').deb.depends).toEqual(expect.arrayContaining([
      'libegl1', 'libgles2', 'libgtk-3-0', 'libnss3', 'libxss1', 'libsecret-1-0',
    ]));
  });

  it('publishes every app from its own generic feed', () => {
    const urls = APPS.map((app) => {
      const publish = readBuilderConfig(app.appDir).publish;

      expect(publish.provider).toBe('generic');
      expect(publish.url).toContain(app.feedTag);
      return publish.url;
    });

    expect(new Set(urls).size).toBe(APPS.length);
  });

  it('Cast product+legacy Linux identity', () => {
    const pkg = readPackageJson('cast');

    expect(pkg.name).toBe('@lumacast/cast');
    expect(pkg.productName).toBe('LumaCast');

    const config = readBuilderConfig('cast');
    expect(config.appId).toBe('com.lumacast.app');
    expect(config.linux.executableName).toBe(LEGACY_CAST_LINUX_IDENTITY);
    expect(config.deb.packageName).toBe(LEGACY_CAST_LINUX_IDENTITY);
  });

  it('each APPS manifest has a stable release version', () => {
    for (const app of APPS) {
      const { version } = readPackageJson(app.appDir);

      expect(() => parseStableVersion(version, app.appDir)).not.toThrow();
    }
  });

  it('gives every app a product name that matches its manifest', () => {
    for (const app of APPS) {
      expect(readBuilderConfig(app.appDir).productName).toBe(app.productName);
    }
  });

  it('accepts a numeric build revision for Flux only', () => {
    // A build revision lets Flux ship a rebuild of the same feature version.
    // Cast and Cloud stay on strict plain SemVer, and an app-unaware caller
    // cannot read a revision at all.
    expect(parseStableVersion('0.11.0+1', 'flux')).toEqual([0, 11, 0, 1]);
    for (const app of [undefined, 'cast', 'cloud']) {
      expect(() => parseStableVersion('0.11.0+1', app)).toThrow('stable semantic version');
    }
  });
});
