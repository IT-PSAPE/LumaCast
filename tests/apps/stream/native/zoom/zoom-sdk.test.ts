// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../../../..');
const fixture = path.join(import.meta.dirname, 'zoom-sdk.fixture.cc');
const scenarios = path.join(import.meta.dirname, 'zoom-sdk.node-test.cjs');

function run(command: string, args: string[], env = process.env) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env, timeout: 25_000 });
  if (result.error) throw result.error;
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return result.stdout;
}

function headers(candidates: string[]) {
  const directory = candidates.find((candidate) => existsSync(path.join(candidate, 'node_api.h')));
  if (!directory) throw new Error(`Cached N-API headers required; checked ${candidates.join(', ')}`);
  return directory;
}

function nodeHeaders() {
  return headers([
    path.join(homedir(), 'Library/Caches/node-gyp', process.versions.node, 'include/node'),
    path.join(homedir(), '.cache/node-gyp', process.versions.node, 'include/node'),
    path.resolve(path.dirname(process.execPath), '../include/node'),
    '/usr/include/node',
  ]);
}

describe.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('Zoom native addon lifecycle with a fake SDK', () => {
  let directory: string;

  beforeAll(() => { directory = mkdtempSync(path.join(tmpdir(), 'stream-zoom-sdk-')); });
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  function build(name: string, include: string) {
    const output = path.join(directory, `${name}.node`);
    run(process.platform === 'darwin' ? 'clang++' : 'g++', [
      '-std=c++17', '-shared', '-fPIC', '-pthread', '-O2', '-Wall', '-Wextra', '-Werror',
      '-DNAPI_CPP_EXCEPTIONS', '-DNAPI_VERSION=8',
      '-I', path.dirname(require.resolve('node-addon-api/napi.h')), '-I', include,
      ...(process.platform === 'darwin' ? ['-undefined', 'dynamic_lookup'] : []),
      fixture, '-o', output,
    ]);
    return output;
  }

  it('verifies actual N-API queue and environment teardown in Node', () => {
    const include = nodeHeaders();
    const output = run(process.execPath, [scenarios, build('node-zoom-sdk', include)]);
    expect(output).toContain('PASS 10 native Zoom lifecycle scenarios (Node)');
  }, 30_000);

  it('verifies the same N-API ABI in the installed Electron runtime', () => {
    const electron = require('electron') as string;
    const electronRoot = path.dirname(require.resolve('electron/package.json'));
    const version = readFileSync(path.join(electronRoot, 'dist/version'), 'utf8').trim();
    const electronCache = path.join(homedir(), '.electron-gyp');
    const include = headers([
      path.join(electronCache, version, 'include/node'),
      path.join(homedir(), 'Library/Caches/node-gyp', version, 'include/node'),
      path.join(homedir(), '.cache/node-gyp', version, 'include/node'),
      // N-API v8 is ABI-stable across Electron versions; no SDK/header download.
      ...(existsSync(electronCache)
        ? readdirSync(electronCache).sort().map((cached) => path.join(electronCache, cached, 'include/node'))
        : []),
      nodeHeaders(),
    ]);
    const output = run(electron, [scenarios, build('electron-zoom-sdk', include)], {
      ...process.env, ELECTRON_RUN_AS_NODE: '1',
    });
    expect(output).toContain('PASS 10 native Zoom lifecycle scenarios (Electron)');
  }, 30_000);
});
