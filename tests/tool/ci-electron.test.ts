// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareAppElectron, main } from '../../tool/ci/prepare-electron.mjs';
import { commandSpec, parseArgs, planFor } from '../../tool/ci/run.mjs';
import type { DependencyGraph } from '../../tool/ci/affected-apps.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-electron-'));
  roots.push(root);
  const app = path.join(root, 'apps/cast');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ devDependencies: { electron: '44.10.2' } }));
  return { root, app };
}
function electron(directory: string, version = '44.10.2', lazy = false) {
  const packageDirectory = path.join(directory, 'node_modules/electron');
  fs.mkdirSync(packageDirectory, { recursive: true });
  fs.writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: 'electron', version, main: 'index.js' }));
  const binaryPath = path.join(packageDirectory, 'dist with spaces', 'electron');
  const sandboxPath = path.join(path.dirname(binaryPath), 'chrome-sandbox');
  const create = `const fs=require('node:fs');fs.mkdirSync(${JSON.stringify(path.dirname(binaryPath))},{recursive:true});fs.writeFileSync(${JSON.stringify(binaryPath)},'binary');fs.writeFileSync(${JSON.stringify(sandboxPath)},'helper');fs.writeFileSync(require('node:path').join(__dirname,'path.txt'),'dist with spaces/electron');`;
  fs.writeFileSync(path.join(packageDirectory, 'index.js'), `${lazy ? create : ''}module.exports=${JSON.stringify(binaryPath)};`);
  if (!lazy) {
    fs.mkdirSync(path.dirname(binaryPath));
    fs.writeFileSync(binaryPath, 'binary');
    fs.writeFileSync(sandboxPath, 'helper');
  }
  return { binaryPath, sandboxPath, packagePath: fs.realpathSync(path.join(packageDirectory, 'package.json')), version };
}
beforeEach(() => { vi.spyOn(childProcess, 'execFileSync').mockReturnValue('44.10.2\n'); });
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('selected app Electron provisioning', () => {
  it.each([false, true])('resolves the sandbox beside the actual runtime, nested=%s', (nested) => {
    const { root, app } = fixture();
    if (nested) electron(root, '35.7.5');
    const expected = electron(nested ? app : root);
    expect(prepareAppElectron('cast', { rootDir: root, platform: 'linux' })).toEqual(expected);
    expect(childProcess.execFileSync).toHaveBeenCalledWith(expected.binaryPath, ['-p', 'process.versions.electron'],
      expect.objectContaining({ env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }) }));
  });

  it('requires the lazy package before checking its previously missing helper', () => {
    const { root } = fixture(); const expected = electron(root, '44.10.2', true);
    expect(fs.existsSync(expected.sandboxPath)).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(expected.packagePath), 'path.txt'))).toBe(false);
    expect(prepareAppElectron('cast', { rootDir: root, platform: 'linux' })).toEqual(expected);
    expect(fs.readFileSync(expected.sandboxPath, 'utf8')).toBe('helper');
  });

  it('rejects installer, package-version, binary-version and execution failures', () => {
    const { root } = fixture(); const runtime = electron(root);
    fs.writeFileSync(path.join(path.dirname(runtime.packagePath), 'index.js'), "throw new Error('synthetic install failed');");
    expect(() => prepareAppElectron('cast', { rootDir: root })).toThrow('synthetic install failed');
    const second = fixture(); electron(second.root, '35.7.5');
    expect(() => prepareAppElectron('cast', { rootDir: second.root })).toThrow('resolved 35.7.5');
    const third = fixture(); electron(third.root);
    vi.mocked(childProcess.execFileSync).mockReturnValueOnce('35.7.5\n');
    expect(() => prepareAppElectron('cast', { rootDir: third.root })).toThrow('binary 44.10.2, got 35.7.5');
    vi.mocked(childProcess.execFileSync).mockImplementationOnce(() => { throw new Error('binary could not execute'); });
    expect(() => prepareAppElectron('cast', { rootDir: third.root })).toThrow('binary could not execute');
  });

  it('validates a regular Linux helper and does not require it on Mac or Windows', () => {
    const { root } = fixture(); const runtime = electron(root); fs.unlinkSync(runtime.sandboxPath);
    expect(() => prepareAppElectron('cast', { rootDir: root, platform: 'linux' })).toThrow('chrome-sandbox');
    fs.mkdirSync(runtime.sandboxPath);
    expect(() => prepareAppElectron('cast', { rootDir: root, platform: 'linux' })).toThrow('not a regular file');
    for (const platform of ['darwin', 'win32'] as const) {
      expect(prepareAppElectron('cast', { rootDir: root, platform }).sandboxPath).toBeNull();
    }
  });

  it('writes paths with spaces directly to GitHub outputs and propagates output errors', () => {
    const { root } = fixture(); const runtime = electron(root, '44.10.2', true);
    const output = path.join(root, 'github output');
    main(['--github-output'], { APP: 'cast', GITHUB_OUTPUT: output }, { rootDir: root, platform: 'linux' });
    expect(fs.readFileSync(output, 'utf8')).toContain(`sandbox_path=${runtime.sandboxPath}\n`);
    expect(() => main(['--app', 'cast', '--github-output'], { GITHUB_OUTPUT: root }, { rootDir: root, platform: 'linux' })).toThrow();
    expect(() => main(['--app', '../cast'], {}, { rootDir: root })).toThrow('workspace name');
  });

  it('returns a nonzero CLI status on an installer failure without reaching a binary probe', () => {
    const { root } = fixture(); const runtime = electron(root);
    fs.writeFileSync(path.join(path.dirname(runtime.packagePath), 'index.js'), "throw new Error('synthetic install failed');");
    fs.mkdirSync(path.join(root, 'tool/ci'), { recursive: true });
    for (const rel of ['tool/ci/prepare-electron.mjs', 'tool/app-electron.mjs']) fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
    const result = childProcess.spawnSync(process.execPath, ['tool/ci/prepare-electron.mjs', '--app', 'cast'], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(1); expect(result.stderr).toContain('synthetic install failed');
    expect(result.stdout).not.toContain('ready');
  });
});

describe('local runtime prerequisites', () => {
  const graph: DependencyGraph = { apps: ['cast'], packages: [], appPackages: new Map([['cast', new Set()]]), packageEdges: new Map(), dependents: new Map() };
  it.each(['native', 'e2e'])('provisions before --only %s consumers', (step) => {
    const plan = planFor('cast', graph, parseArgs(['--app', 'cast', '--e2e', '--only', step]));
    expect(plan[0]).toMatchObject({ step: 'runtime', executable: process.execPath, args: ['tool/ci/prepare-electron.mjs', '--app', 'cast'] });
    expect(plan.slice(1).every((entry) => entry.step === step)).toBe(true);
  });
  it.each(['typecheck', 'architecture'])('does not download a runtime for --only %s', (step) => {
    expect(planFor('cast', graph, parseArgs(['--app', 'cast', '--only', step])).some((entry) => entry.step === 'runtime')).toBe(false);
  });
  it('rejects skipping a required runtime and permits a selection with no runtime consumer', () => {
    expect(() => planFor('cast', graph, parseArgs(['--app', 'cast', '--only', 'native', '--skip', 'runtime']))).toThrow('runtime is required');
    expect(planFor('cast', graph, parseArgs(['--app', 'cast', '--only', 'build', '--skip', 'runtime']))[0].step).toBe('build');
  });
  it('runs Node helper paths with spaces as argv without a Windows shell', () => {
    const executable = 'C:\\Program Files\\nodejs\\node.exe';
    const args = ['tool/ci/prepare-electron.mjs', '--app', 'cast'];
    expect(commandSpec(executable, args, 'win32')).toEqual({ command: executable, args, shell: false });
    expect(commandSpec('npm', ['run', 'build:cast'], 'win32')).toEqual({ command: 'npm.cmd', args: ['run', 'build:cast'], shell: true });
  });
  it('stops local native stages when the actual runtime preparation process fails', () => {
    const { root } = fixture();
    const result = childProcess.spawnSync(process.execPath, ['tool/ci/run.mjs', '--app', 'cast', '--only', 'native'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: path.join(root, 'missing runtime') },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('cast: provision Electron failed');
    expect(result.stdout).toMatch(/skip\s+cast: NDI native tests/);
    expect(result.stdout).not.toContain('$ npm run test:ndi-native');
  });
});
