#!/usr/bin/env node

// The per-app validation pipeline, runnable identically on a laptop and in
// GitHub Actions. `.github/workflows/ci-release.yml` calls this script for the
// one app it validates; locally it runs any selection of apps, or exactly the
// apps the gate would pick for the current diff. Keeping every step here means
// there is one definition of "CI passes" and it can be reproduced before a push.
//
//   node tool/ci/run.mjs --app cast                 one app
//   node tool/ci/run.mjs --app cast --app cloud     several apps
//   node tool/ci/run.mjs --all                      every app
//   node tool/ci/run.mjs --affected [--base <ref>]  what the gate would run
//                                                   (default base: origin/main)
//   node tool/ci/run.mjs --list-steps
//
// Options: --e2e runs the Cast end-to-end suite (needs the Playwright Chromium
// build); --skip <steps> and --only <steps> take comma-separated step names;
// --head <ref> pairs with --affected.
//
// Steps, in order. Shared steps run once per invocation, app steps once per app:
//   deps          ensure native packages (shared)
//   typecheck     root tsc plus the app workspace tsconfig
//   architecture  boundary check and the checker's own fixtures (shared)
//   unit          Vitest, scoped to the app's tests, its packages' tests, and
//                 the shared tool tests
//   native        Cast only: the NDI native addon and frame-transport tests
//   build         electron-vite build for the app
//   e2e           Cast only, with --e2e: Playwright against the built app

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDependencyGraph, decideApps, testPathsFor } from './affected-apps.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STEPS = ['deps', 'typecheck', 'architecture', 'unit', 'native', 'build', 'e2e'];
const SHARED_STEPS = new Set(['deps', 'architecture']);
const IS_WINDOWS = process.platform === 'win32';
const IN_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

function parseArgs(argv) {
  const options = { apps: [], all: false, affected: false, e2e: false, skip: new Set(), only: null, head: 'HEAD' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} expects a value.`);
      return argv[index];
    };
    const steps = (value) => value.split(',').map((step) => step.trim()).filter(Boolean);
    if (arg === '--app') options.apps.push(...next().split(',').map((app) => app.trim()).filter(Boolean));
    else if (arg === '--all') options.all = true;
    else if (arg === '--affected') options.affected = true;
    else if (arg === '--base') options.base = next();
    else if (arg === '--head') options.head = next();
    else if (arg === '--e2e') options.e2e = true;
    else if (arg === '--skip') for (const step of steps(next())) options.skip.add(step);
    else if (arg === '--only') options.only = new Set(steps(next()));
    else if (arg === '--list-steps') options.listSteps = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument ${arg}.`);
  }
  for (const step of [...options.skip, ...(options.only ?? [])]) {
    if (!STEPS.includes(step)) throw new Error(`Unknown step "${step}"; expected one of ${STEPS.join(', ')}.`);
  }
  return options;
}

function selectApps(options) {
  const graph = buildDependencyGraph(ROOT);
  if (options.all) return { graph, apps: [...graph.apps], why: 'every app' };
  if (options.affected) {
    const base = options.base ?? defaultBaseline();
    const decision = decideApps({ rootDir: ROOT, base, head: options.head });
    const why =
      decision.mode === 'no-baseline'
        ? `every app (no usable baseline: ${base || 'none'})`
        : `${decision.apps.length} affected app(s) since ${base}`;
    return { graph, apps: decision.apps, why, decision };
  }
  if (options.apps.length === 0) throw new Error('Pass --app <name>, --all, or --affected.');
  const unknown = options.apps.filter((app) => !graph.apps.includes(app));
  if (unknown.length > 0) throw new Error(`Unknown app(s) ${unknown.join(', ')}; expected any of ${graph.apps.join(', ')}.`);
  return { graph, apps: graph.apps.filter((app) => options.apps.includes(app)), why: 'explicit selection' };
}

// Locally the interesting question is "what would CI run for what I am about
// to push", so the default baseline is the upstream main branch when the clone
// has one, and otherwise the previous commit.
function defaultBaseline() {
  for (const candidate of ['origin/main', 'HEAD~1']) {
    const probe = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { cwd: ROOT, encoding: 'utf8' });
    if (probe.status === 0) return probe.stdout.trim();
  }
  return '';
}

function commandFor(executable) {
  if (!IS_WINDOWS) return executable;
  return executable === 'npm' || executable === 'npx' ? `${executable}.cmd` : executable;
}

function hasCommand(name) {
  const probe = spawnSync(IS_WINDOWS ? 'where' : 'which', [name], { encoding: 'utf8' });
  return probe.status === 0;
}

function run(label, executable, args, env = {}) {
  const started = Date.now();
  if (IN_ACTIONS) process.stdout.write(`::group::${label}\n`);
  process.stdout.write(`\n$ ${[executable, ...args].join(' ')}\n`);
  const result = spawnSync(commandFor(executable), args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: IS_WINDOWS,
    env: { ...process.env, ...env },
  });
  if (IN_ACTIONS) process.stdout.write('::endgroup::\n');
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.error) throw result.error;
  return { ok: result.status === 0, seconds, status: result.status };
}

function stepEnabled(step, options, app) {
  if (options.skip.has(step)) return false;
  if (options.only && !options.only.has(step)) return false;
  if (step === 'native' && app !== 'cast') return false;
  if (step === 'e2e' && (app !== 'cast' || !options.e2e)) return false;
  return true;
}

function planFor(app, graph, options) {
  const plan = [];
  const add = (step, label, executable, args, env) => plan.push({ step, label, executable, args, env });
  if (stepEnabled('typecheck', options, app)) {
    add('typecheck', `${app}: root typecheck`, 'npx', ['tsc', '--noEmit']);
    add('typecheck', `${app}: workspace typecheck`, 'npm', ['run', 'typecheck', '--workspace', `apps/${app}`, '--if-present']);
  }
  if (stepEnabled('unit', options, app)) {
    add('unit', `${app}: unit tests`, 'npx', ['vitest', 'run', ...testPathsFor(app, graph)]);
  }
  if (stepEnabled('native', options, app)) {
    add('native', `${app}: NDI native tests`, 'npm', ['run', 'test:ndi-native']);
    add('native', `${app}: NDI transport tests`, 'npm', ['run', 'test:ndi-transport']);
    add('native', `${app}: NDI GPU output tests`, 'npm', ['run', 'test:ndi-gpu']);
  }
  if (stepEnabled('build', options, app)) {
    add('build', `${app}: build`, 'npm', ['run', `build:${app}`]);
  }
  if (stepEnabled('e2e', options, app)) {
    // Playwright drives the built Electron app, which needs a display on Linux.
    const args = ['playwright', 'test'];
    if (process.platform === 'linux' && hasCommand('xvfb-run')) {
      add('e2e', `${app}: end-to-end tests`, 'xvfb-run', ['--auto-servernum', 'npx', ...args], { DEBUG: 'pw:browser' });
    } else {
      add('e2e', `${app}: end-to-end tests`, 'npx', args, { DEBUG: 'pw:browser' });
    }
  }
  return plan;
}

function sharedPlan(options) {
  const plan = [];
  if (!options.skip.has('deps') && (!options.only || options.only.has('deps'))) {
    plan.push({ step: 'deps', label: 'ensure native packages', executable: 'npm', args: ['run', 'ensure:native-deps'] });
  }
  if (!options.skip.has('architecture') && (!options.only || options.only.has('architecture'))) {
    plan.push({ step: 'architecture', label: 'architecture boundaries', executable: 'npm', args: ['run', 'check:architecture'] });
    plan.push({ step: 'architecture', label: 'architecture checker fixtures', executable: 'npm', args: ['run', 'test:architecture'] });
  }
  return plan;
}

function printSummary(results) {
  const width = Math.max(...results.map((entry) => entry.label.length), 10);
  process.stdout.write('\nSummary\n');
  for (const entry of results) {
    const status = entry.ok === true ? 'ok  ' : entry.ok === false ? 'FAIL' : 'skip';
    process.stdout.write(`  ${status}  ${entry.label.padEnd(width)}  ${entry.seconds ?? ''}${entry.seconds ? 's' : ''}\n`);
  }
  if (IN_ACTIONS && process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((entry) => `| ${entry.label} | ${entry.ok === true ? 'ok' : entry.ok === false ? 'failed' : 'skipped'} | ${entry.seconds ?? ''} |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Validation steps\n\n| Step | Result | Seconds |\n| --- | --- | --- |\n${rows.join('\n')}\n`);
  }
}

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 30).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'));
    process.stdout.write('\n');
    return 0;
  }
  if (options.listSteps) {
    process.stdout.write(`${STEPS.join('\n')}\n`);
    return 0;
  }

  const { graph, apps, why, decision } = selectApps(options);
  process.stdout.write(`Apps: ${apps.join(', ') || 'none'} (${why})\n`);
  if (decision?.changes?.length) {
    for (const change of decision.changes) {
      const target = change.scope === 'all' ? 'every app' : change.scope === 'none' ? 'no app' : change.apps.join(', ');
      process.stdout.write(`  ${change.file} → ${target}\n`);
    }
  }
  if (apps.length === 0) {
    process.stdout.write('Nothing to validate.\n');
    return 0;
  }

  const results = [];
  let failed = false;
  const execute = (entry) => {
    if (failed) {
      results.push({ ...entry, ok: null });
      return;
    }
    const outcome = run(entry.label, entry.executable, entry.args, entry.env);
    results.push({ ...entry, ...outcome });
    if (!outcome.ok) {
      failed = true;
      process.stdout.write(`\n${entry.label} failed (exit ${outcome.status}).\n`);
    }
  };

  for (const entry of sharedPlan(options)) execute(entry);
  for (const app of apps) {
    for (const entry of planFor(app, graph, options)) execute(entry);
  }
  printSummary(results);
  return failed ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

export { STEPS, SHARED_STEPS };
