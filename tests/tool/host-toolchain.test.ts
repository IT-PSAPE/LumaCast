// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readToolchain, runCiNpm } from '../../tool/ci/setup-npm.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-host-toolchain-'));
afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));
let sequence = 0;
function fixture(spec = 'npm@11.21.2') {
  const rootDir = path.join(temp, String(sequence++));
  fs.mkdirSync(rootDir);
  fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ packageManager: spec }));
  fs.writeFileSync(path.join(rootDir, '.nvmrc'), '22.23.4\n');
  return {
    rootDir, nodeVersion: '22.23.4',
    env: { GITHUB_ACTIONS: 'true', npm_execpath: path.join(rootDir, 'bundled/npm-cli.js'),
      RUNNER_TEMP: path.join(rootDir, 'runner'), GITHUB_PATH: path.join(rootDir, 'github-path') },
  };
}

describe('declared host toolchain', () => {
  it('keeps Cast aligned with the root package manager and the API compatibility floor', () => {
    const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const cast = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/cast/package.json'), 'utf8'));
    expect(cast.packageManager).toBe(root.packageManager);
    expect(root.engines.node).toBe('>=22.18.0');
    expect(readToolchain(ROOT)).toEqual({ node: '22.23.4', npm: '11.21.2', packageManager: root.packageManager });
  });

  it.each(['npm@^11.21.2', 'npm@11.21.2 --global', 'pnpm@11.21.2', 'npm@011.21.2', 'npm@11.21'])('rejects an inexact or executable package spec %s', (spec) => {
    expect(() => readToolchain(fixture(spec).rootDir)).toThrow('exact npm@x.y.z');
  });

  it('bootstraps only into private runner temp and publishes PATH after verifying the new CLI', () => {
    const options = fixture();
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const result = runCiNpm('setup', { ...options, run(command, args, config) {
      calls.push({ command, args, cwd: config.cwd?.toString() });
      expect(fs.existsSync(options.env.GITHUB_PATH)).toBe(false);
      return { status: 0, stdout: args.includes('--version') ? '11.21.2\n' : '' };
    } });
    const prefix = path.join(options.env.RUNNER_TEMP, 'lumacast-npm-11.21.2');
    expect(result.npm).toBe('11.21.2');
    expect(calls).toEqual([
      { command: process.execPath, args: [options.env.npm_execpath, 'install', '--prefix', prefix, '--no-save', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', '--workspaces=false', 'npm@11.21.2'], cwd: prefix },
      { command: process.execPath, args: [path.join(prefix, 'node_modules/npm/bin/npm-cli.js'), '--version'], cwd: options.rootDir },
    ]);
    expect(fs.readFileSync(options.env.GITHUB_PATH, 'utf8')).toBe(`${path.join(prefix, 'node_modules/.bin')}\n`);
  });

  it('checks the invoking CLI before using that exact JS entry for ci', () => {
    const options = fixture();
    const argsSeen: string[][] = [];
    runCiNpm('install', { ...options, run(command, args) {
      expect(command).toBe(process.execPath);
      argsSeen.push(args);
      return { status: 0, stdout: '11.21.2\n' };
    } });
    expect(argsSeen).toEqual([[options.env.npm_execpath, '--version'], [options.env.npm_execpath, 'ci']]);
    expect(fs.existsSync(options.env.GITHUB_PATH)).toBe(false);
  });

  it('does not install dependencies after an incorrect actual npm version', () => {
    const options = fixture();
    let calls = 0;
    expect(() => runCiNpm('install', { ...options, run() { calls++; return { status: 0, stdout: '10.9.3' }; } })).toThrow('Expected npm 11.21.2');
    expect(calls).toBe(1);
  });

  it.each(['setup', 'install'] as const)('propagates %s subprocess failures', (mode) => {
    const options = fixture();
    expect(() => runCiNpm(mode, { ...options, run() { return { status: 9 }; } })).toThrow('status 9');
    expect(fs.existsSync(options.env.GITHUB_PATH)).toBe(false);
    expect(() => runCiNpm(mode, { ...options, run() { return { status: null, error: new Error('spawn failed') }; } })).toThrow('spawn failed');
  });

  it('does not publish a failed bootstrap and never changes a developer installation', () => {
    const options = fixture();
    expect(() => runCiNpm('setup', { ...options, run(_command, args) { return { status: 0, stdout: args.includes('--version') ? '10.9.3' : '' }; } })).toThrow('Expected npm 11.21.2');
    expect(fs.existsSync(options.env.GITHUB_PATH)).toBe(false);
    const run = () => { throw new Error('must not execute'); };
    expect(() => runCiNpm('setup', { ...options, env: {}, run })).toThrow('CI-only');
    expect(() => runCiNpm('setup', { ...options, nodeVersion: '22.18.0', run })).toThrow('Expected Node 22.23.4');
    expect(() => runCiNpm('setup', { ...options, env: { ...options.env, npm_execpath: 'npm.cmd' }, run })).toThrow('npm_execpath');
    expect(() => runCiNpm('setup', { ...options, env: { ...options.env, RUNNER_TEMP: 'relative' }, run })).toThrow('absolute RUNNER_TEMP');
  });
});
