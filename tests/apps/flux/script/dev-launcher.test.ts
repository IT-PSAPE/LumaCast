import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = path.resolve(__dirname, '../../../../apps/flux');
const launcher = readFileSync(path.join(APP_DIR, 'script', 'dev.mjs'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const require = createRequire(import.meta.url);

describe('apps/flux dev launcher', () => {
  it('resolves the electron-vite bin through the package export map', () => {
    // `electron-vite/cli.js` is not an exported subpath, so requiring it fails
    // with ERR_PACKAGE_PATH_NOT_EXPORTED; the bin lives beside the manifest.
    expect(launcher).toContain("require.resolve('electron-vite/package.json'");
    expect(launcher).toContain("'bin', 'electron-vite.js'");
    expect(launcher).not.toContain("require.resolve('electron-vite/cli.js'");

    const bin = path.join(
      path.dirname(require.resolve('electron-vite/package.json', { paths: [APP_DIR] })),
      'bin',
      'electron-vite.js',
    );
    expect(existsSync(bin)).toBe(true);
  });

  it('drives dev and preview through the same pinned Electron resolver', () => {
    expect(launcher).toContain("const MODES = ['dev', 'preview']");
    expect(launcher).toContain('ELECTRON_EXEC_PATH: electronPath');

    expect(manifest.scripts.dev).toContain('dev');
    expect(manifest.scripts.preview).toBe('node script/dev.mjs preview');
  });
});
