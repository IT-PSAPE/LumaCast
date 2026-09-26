import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  deb: { packageName: string };
}

function readBuilderConfig(appDir: string): BuilderConfig {
  const doc = yaml.load(
    fs.readFileSync(path.join(repoRoot, 'apps', appDir, 'electron-builder.yml'), 'utf8'),
  );
  return doc as BuilderConfig;
}

function readPackageJson(appDir: string): { name: string; version: string; productName?: string } {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'apps', appDir, 'package.json'), 'utf8'),
  );
}

// The legacy Linux identity is the unscoped npm name the app shipped under
// before the monorepo restructure; deb packages and executables keep it.
const LEGACY_CAST_LINUX_IDENTITY = 'lumacast';

describe('app packaging config', () => {
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
