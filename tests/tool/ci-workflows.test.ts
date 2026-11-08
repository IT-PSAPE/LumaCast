// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildDependencyGraph } from '../../tool/ci/affected-apps.mjs';
import { checkCiResults } from '../../tool/ci/check-results.mjs';
import { isReleaseApp, RELEASE_APPS } from '../../tool/release-version.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as { load(source: string): unknown };
interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  needs?: string | string[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps?: Step[];
}
interface Workflow {
  on?: { workflow_call?: { outputs?: Record<string, { value: string }> } };
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

function readWorkflow(file: string): Workflow {
  return yaml.load(fs.readFileSync(path.join(ROOT, '.github/workflows', file), 'utf8')) as Workflow;
}

const gate = readWorkflow('ci.yml');
const pipeline = readWorkflow('ci-release.yml');
const validation = readWorkflow('ci-validate.yml');
const graph = buildDependencyGraph(ROOT);
const appNames: string[] = graph.apps;
type JobResults = Record<string, { result: string; outputs?: { apps: string } }>;

function resultsFor(selected: unknown = []): JobResults {
  const results: JobResults = Object.fromEntries(appNames.map((app) => [app, { result: 'skipped' }]));
  if (Array.isArray(selected)) {
    for (const app of selected) {
      if (appNames.includes(app)) results[app] = { result: 'success' };
    }
  }
  results.detect = { result: 'success', outputs: { apps: JSON.stringify(selected) } };
  return results;
}

describe('CI result gate', () => {
  it.each(appNames)('requires the selected %s app to succeed', (app) => {
    const results = resultsFor([app]);
    expect(checkCiResults(results)).toEqual([app]);
    for (const result of ['skipped', 'failure', 'cancelled', '']) {
      results[app] = { result };
      expect(() => checkCiResults(results), result).toThrow(`Selected application '${app}'`);
    }
  });

  it('accepts a successful all-app run and a documentation-only run', () => {
    expect(checkCiResults(resultsFor(appNames))).toEqual(appNames);
    expect(checkCiResults(resultsFor([]))).toEqual([]);
  });

  it('fails when a selected application has no corresponding job', () => {
    const results = resultsFor(['stream']);
    delete results.stream;
    expect(() => checkCiResults(results)).toThrow('has no validation job result');
    expect(() => checkCiResults(resultsFor(['future-app']))).toThrow('has no validation job result');
  });

  it('rejects a failed or missing detector even when every app was skipped', () => {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const results = resultsFor([]);
      results.detect.result = result;
      expect(() => checkCiResults(results)).toThrow('Affected-app detection failed');
    }
    const results = resultsFor([]);
    delete results.detect;
    expect(() => checkCiResults(results)).toThrow('Affected-app detection failed');
  });

  it('rejects missing or malformed selection rather than treating it as no changes', () => {
    for (const selection of [null, {}, 'stream', [null], ['detect'], ['stream', 'stream']]) {
      expect(() => checkCiResults(resultsFor(selection))).toThrow();
    }
    for (const apps of ['', 'not-json']) {
      const results = resultsFor();
      results.detect.outputs = { apps };
      expect(() => checkCiResults(results)).toThrow('not valid JSON');
    }
    const results = resultsFor();
    delete results.detect.outputs;
    expect(() => checkCiResults(results)).toThrow('not valid JSON');
  });

  it('does not hide an unexpected failure in an unselected job', () => {
    const results = resultsFor([]);
    results.stream = { result: 'failure' };
    expect(() => checkCiResults(results)).toThrow("Application 'stream' validation ended with 'failure'");
  });

  it('returns a failing process status when a selected app was skipped', () => {
    const results = resultsFor(['soundboard']);
    results.soundboard = { result: 'skipped' };
    const run = spawnSync(process.execPath, ['tool/ci/check-results.mjs'], {
      cwd: ROOT,
      env: { ...process.env, CI_JOB_RESULTS: JSON.stringify(results) },
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Selected application 'soundboard'");
  });
});

describe('CI workspace coverage and release isolation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-workflow-contract-'));
  afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));

  it('uses one Node pin and selects the declared npm before every clean install', () => {
    let nodeJobs = 0;
    let installs = 0;
    for (const workflow of [gate, pipeline, validation]) {
      for (const job of Object.values(workflow.jobs)) {
        const steps = job.steps ?? [];
        const setup = steps.findIndex((step) => step.uses?.startsWith('actions/setup-node@'));
        if (setup !== -1) {
          nodeJobs++;
          expect(steps[setup].with?.['node-version-file']).toBe('.nvmrc');
          expect(steps[setup].with?.['node-version']).toBeUndefined();
        }
        const install = steps.findIndex((step) => step.name === 'Install dependencies');
        if (install !== -1) {
          installs++;
          const selection = steps.findIndex((step) => step.name === 'Select declared npm');
          expect(setup).toBeGreaterThanOrEqual(0);
          expect(selection).toBeGreaterThan(setup);
          expect(selection).toBeLessThan(install);
          expect(steps[selection].run).toBe('npm run ci:setup-npm');
          expect(steps[install].run).toBe('npm run ci:install');
        } else {
          expect(steps.some((step) => step.name === 'Select declared npm')).toBe(false);
        }
      }
    }
    expect(nodeJobs).toBe(7);
    expect(installs).toBe(4);
  });

  it('prepares the selected app runtime before sandbox and native/build consumers', () => {
    const steps = validation.jobs.validate.steps!;
    const prepare = steps.findIndex((step) => step.id === 'runtime');
    const install = steps.findIndex((step) => step.name === 'Install dependencies');
    const browser = steps.findIndex((step) => step.name === 'Install Playwright browser dependencies');
    const sandbox = steps.findIndex((step) => step.name === 'Configure Electron sandbox helper');
    expect(prepare).toBeGreaterThan(install);
    expect(prepare).toBeGreaterThan(browser);
    expect(prepare).toBeLessThan(sandbox);
    expect(steps[prepare].env?.APP).toBe('${{ inputs.app }}');
    expect(steps[prepare].run).toBe('node tool/ci/prepare-electron.mjs --github-output');
    expect(steps[sandbox].env?.ELECTRON_SANDBOX).toBe('${{ steps.runtime.outputs.sandbox_path }}');
    expect(steps[sandbox].run).toContain('sudo chown root:root "$ELECTRON_SANDBOX"');
    expect(steps[sandbox].run).toContain('sudo chmod 4755 "$ELECTRON_SANDBOX"');
    expect(steps[sandbox].run).not.toContain('node_modules/electron');
    for (const name of ['native-gpu', 'package']) {
      const job = pipeline.jobs[name]; const entries = job.steps!;
      const provision = entries.findIndex((step) => step.name === 'Prepare app Electron');
      expect(provision).toBeGreaterThan(entries.findIndex((step) => step.name === 'Install dependencies'));
      expect(provision).toBeLessThan(entries.findIndex((step) => step.name === 'Build native NDI addon'));
      expect(entries[provision].run).toBe(name === 'native-gpu' ? 'node tool/ci/prepare-electron.mjs --app cast' : 'node tool/ci/prepare-electron.mjs');
    }
    expect(pipeline.jobs.feed.steps!.some((step) => step.name === 'Prepare app Electron')).toBe(false);
  });

  it('passes the derived Linux helper with spaces as one argument to each privileged command', () => {
    const sandbox = validation.jobs.validate.steps!.find((step) => step.name === 'Configure Electron sandbox helper')!;
    const bin = path.join(temp, 'sandbox-command-control'); fs.mkdirSync(bin);
    const log = path.join(bin, 'arguments.jsonl');
    const sudo = path.join(bin, 'sudo');
    fs.writeFileSync(sudo, '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.SANDBOX_LOG,JSON.stringify(process.argv.slice(2))+"\\n");\n', { mode: 0o755 });
    const helper = path.join(bin, 'app local dist with spaces', 'chrome-sandbox');
    const result = spawnSync('bash', ['-e', '-c', sandbox.run!], {
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, ELECTRON_SANDBOX: helper, SANDBOX_LOG: log }, encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line))).toEqual([
      ['chown', 'root:root', helper], ['chmod', '4755', helper],
    ]);
  });

  it('wires every workspace through selection, reusable validation, and summary', () => {
    for (const app of appNames) {
      const job = gate.jobs[app];
      expect(job, app).toBeDefined();
      expect(gate.jobs.detect.outputs?.[app]).toBe('${{ steps.affected.outputs.' + app + ' }}');
      expect(job.if).toBe(`needs.detect.outputs.${app} == 'true'`);
      expect(job.uses).toBe(isReleaseApp(app) ? './.github/workflows/ci-release.yml' : './.github/workflows/ci-validate.yml');
      expect(job.with?.app).toBe(app);
      expect(gate.jobs.summary.needs).toContain(app);
    }
    const summary = gate.jobs.summary.steps!.find((step) => step.name === 'Evaluate app results')!;
    expect(summary.run).toBe('node tool/ci/check-results.mjs');
    expect(summary.env?.CI_JOB_RESULTS).toBe('${{ toJSON(needs) }}');
    expect(gate.jobs.summary.steps!.some((step) => step.uses?.startsWith('actions/checkout@'))).toBe(true);
  });

  it.each(['stream', 'soundboard'])('validates %s with read-only permissions and publishing disabled', (app) => {
    expect(gate.jobs[app].uses).toBe('./.github/workflows/ci-validate.yml');
    expect(gate.jobs[app].with?.release).toBeUndefined();
    expect(gate.jobs[app].permissions?.contents).toBe('read');
    expect(validation.permissions?.contents).toBe('read');
    expect(Object.keys(validation.jobs)).toEqual(['validate']);
  });

  it.each(appNames)('resolves %s validation and its release eligibility from the release policy', (app) => {
    const step = validation.jobs.validate.steps!.find((candidate) => candidate.id === 'app')!;
    const output = path.join(temp, `${app}.txt`);
    const run = spawnSync('bash', ['-c', step.run!], {
      cwd: ROOT,
      env: { ...process.env, APP: app, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    expect(fs.readFileSync(output, 'utf8').trim()).toBe(`release_app=${isReleaseApp(app)}`);
  });

  it('rejects an unsupported application before validation or publishing', () => {
    const step = validation.jobs.validate.steps!.find((candidate) => candidate.id === 'app')!;
    const output = path.join(temp, 'unsupported.txt');
    const run = spawnSync('bash', ['-c', step.run!], {
      cwd: ROOT,
      env: { ...process.env, APP: 'unsupported', GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('Unsupported app');
    expect(fs.existsSync(output)).toBe(false);
  });

  it('requires release eligibility for both push and requested manual publication', () => {
    expect(pipeline.jobs.validate.uses).toBe('./.github/workflows/ci-validate.yml');
    expect(pipeline.jobs.validate.with?.app).toBe('${{ inputs.app }}');
    expect(validation.on?.workflow_call?.outputs?.release_app.value).toBe('${{ jobs.validate.outputs.release_app }}');
    expect(validation.jobs.validate.outputs?.release_app).toBe('${{ steps.app.outputs.release_app }}');
    const condition = pipeline.jobs.detect.if!;
    expect(condition).toContain("needs.validate.outputs.release_app == 'true' &&");
    expect(condition).toContain("github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.release)");
    expect(pipeline.jobs.package.if).toBe("needs.detect.outputs.should_release == 'true'");
    expect(pipeline.jobs.release.if).toBe("needs.detect.outputs.should_release == 'true'");
    expect(pipeline.jobs.feed.if).toContain("needs.detect.result == 'success'");
    expect(RELEASE_APPS).toEqual(['cast', 'cloud', 'flux', 'chord']);
  });
});
