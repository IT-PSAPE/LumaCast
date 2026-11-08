// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAppElectron } from '../../tool/app-electron.mjs';

const roots: string[] = [];

beforeEach(() => {
  vi.spyOn(childProcess, 'execFileSync').mockReturnValue('44.10.2\n');
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-electron-'));
  roots.push(root);
  const app = path.join(root, 'apps', 'stream');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ devDependencies: { electron: '44.10.2' } }));
  return { root, app };
}

function electron(directory: string, version: string) {
  const module = path.join(directory, 'node_modules', 'electron');
  fs.mkdirSync(module, { recursive: true });
  fs.writeFileSync(path.join(module, 'package.json'), JSON.stringify({ name: 'electron', version, main: 'index.js' }));
  const binaryPath = path.join(module, 'runtime');
  fs.writeFileSync(path.join(module, 'index.js'), `module.exports = ${JSON.stringify(binaryPath)};`);
  return { binaryPath, packagePath: fs.realpathSync(path.join(module, 'package.json')), version };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('app Electron resolution', () => {
  it('accepts the declared runtime when npm hoists it to the root', () => {
    const { root } = fixture();
    const expected = electron(root, '44.10.2');
    expect(resolveAppElectron('stream', root)).toEqual(expected);
  });

  it('uses the app runtime when another version is hoisted', () => {
    const { root, app } = fixture();
    electron(root, '35.7.5');
    const expected = electron(app, '44.10.2');
    expect(resolveAppElectron('stream', root)).toEqual(expected);
  });

  it('rejects an app that resolves a different installed runtime', () => {
    const { root } = fixture();
    electron(root, '35.7.5');
    expect(() => resolveAppElectron('stream', root)).toThrow('Expected stream Electron 44.10.2, resolved 35.7.5');
  });

  it('rejects a floating runtime declaration', () => {
    const { root, app } = fixture();
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ devDependencies: { electron: '^44.10.2' } }));
    electron(root, '44.10.2');
    expect(() => resolveAppElectron('stream', root)).toThrow('stream must pin an exact Electron version');
  });

  it('rejects a stale binary override even when the installed package matches', () => {
    const { root } = fixture();
    electron(root, '44.10.2');
    vi.mocked(childProcess.execFileSync).mockReturnValue('35.7.5\n');
    expect(() => resolveAppElectron('stream', root)).toThrow('Expected stream Electron binary 44.10.2, got 35.7.5');
  });
});
