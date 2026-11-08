#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXACT_VERSION = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)';

export function readToolchain(rootDir = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const spec = manifest.packageManager;
  if (typeof spec !== 'string' || !new RegExp(`^npm@${EXACT_VERSION}$`).test(spec)) {
    throw new Error('Root packageManager must select an exact npm@x.y.z version.');
  }
  const node = fs.readFileSync(path.join(rootDir, '.nvmrc'), 'utf8').trim();
  if (!new RegExp(`^${EXACT_VERSION}$`).test(node)) throw new Error('.nvmrc must select an exact Node version.');
  return { node, npm: spec.slice(4), packageManager: spec };
}

export function runCiNpm(mode, { rootDir = ROOT, nodeVersion = process.versions.node,
  env = process.env, run = spawnSync } = {}) {
  if (mode !== 'setup' && mode !== 'install') throw new Error('Expected setup or install mode.');
  if (env.GITHUB_ACTIONS !== 'true') throw new Error('npm selection is CI-only; use the declared npm locally without this installer.');
  const selected = readToolchain(rootDir);
  if (nodeVersion !== selected.node) throw new Error(`Expected Node ${selected.node}, received ${nodeVersion}.`);
  const invokingCli = env.npm_execpath;
  if (!invokingCli || !path.isAbsolute(invokingCli)) throw new Error('Invoke through npm run so npm_execpath identifies the actual npm CLI.');
  const invoke = (cli, args, cwd, capture = false) => {
    // Run npm's JS entry with the selected Node directly. This also works on
    // Windows/pwsh without shell interpolation or .cmd launcher assumptions.
    const result = run(process.execPath, [cli, ...args], {
      cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`npm ${args[0]} failed with status ${result.status}.`);
    return result.stdout?.trim() ?? '';
  };
  const assertVersion = (cli) => {
    const actual = invoke(cli, ['--version'], rootDir, true);
    if (actual !== selected.npm) throw new Error(`Expected npm ${selected.npm}, received ${actual}.`);
  };
  if (mode === 'setup') {
    if (!env.RUNNER_TEMP || !path.isAbsolute(env.RUNNER_TEMP) || !env.GITHUB_PATH || !path.isAbsolute(env.GITHUB_PATH)) {
      throw new Error('CI setup requires absolute RUNNER_TEMP and GITHUB_PATH paths.');
    }
    const prefix = path.join(env.RUNNER_TEMP, `lumacast-npm-${selected.npm}`);
    fs.mkdirSync(prefix, { recursive: true });
    // Only the disposable runner's private directory changes; no global npm or
    // checkout dependencies are installed during bootstrap.
    invoke(invokingCli, ['install', '--prefix', prefix, '--no-save', '--ignore-scripts',
      '--no-package-lock', '--no-audit', '--no-fund', '--workspaces=false', selected.packageManager], prefix);
    assertVersion(path.join(prefix, 'node_modules/npm/bin/npm-cli.js'));
    fs.appendFileSync(env.GITHUB_PATH, `${path.join(prefix, 'node_modules/.bin')}\n`);
  } else {
    // Verify the CLI that actually invoked this step, then use that same CLI
    // for ci. A failed check cannot be hidden by a later PowerShell command.
    assertVersion(invokingCli);
    invoke(invokingCli, ['ci'], rootDir);
  }
  return selected;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const selected = runCiNpm(process.argv[2]);
    console.log(`Using Node ${selected.node} and npm ${selected.npm}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
