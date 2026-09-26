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
  linuxIdentity: string;
  feedTag: string;
}

const APPS: AppPackaging[] = [
  { appDir: 'cast', appId: 'com.lumacast.app', linuxIdentity: 'lumacast', feedTag: 'cast-feed' },
  { appDir: 'cloud', appId: 'com.lumacast.cloud', linuxIdentity: 'lumacloud', feedTag: 'cloud-feed' },
  { appDir: 'flux', appId: 'com.lumacast.flux', linuxIdentity: 'lumaflux', feedTag: 'flux-feed' },
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

  it('each APPS manifest has a stable major.minor.patch version', () => {
    for (const app of APPS) {
      const { version } = readPackageJson(app.appDir);

      expect(() => parseStableVersion(version)).not.toThrow();
    }
  });
});
