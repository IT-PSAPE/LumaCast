#!/usr/bin/env node

// Decides which application workspaces a change affects, so the gating
// workflow (.github/workflows/ci.yml) runs the per-app pipeline only for those
// apps. The same module drives `node tool/ci/run.mjs --affected` locally, so the
// selection a developer sees before pushing is the selection CI makes.
//
// Ownership is derived from the tree, never from a hand-written list:
//
// - `apps/<app>/**`            → that app.
// - `packages/<pkg>/**`        → every app that imports the package, directly or
//                                through other packages. The graph comes from the
//                                static `@lumacast/<pkg>` imports (plus declared
//                                workspace dependencies) of each workspace, so a
//                                package edge that package.json forgot to declare
//                                still counts. A package no app consumes is
//                                treated as shared so its tests never go unrun.
// - `tests/apps/<app>/**`      → that app; `tests/packages/<pkg>/**` → the
//                                package's dependents, as above.
// - shared build/test tooling  → every app: root manifests and lockfile, root
//                                TS/Vitest/Playwright configuration, `tool/`,
//                                `scripts/`, `tests/tool/`, `tests/benchmarks/`,
//                                and `.github/`.
// - documentation              → no app: `docs/`, Markdown outside a workspace,
//                                editor and agent configuration, git metadata.
// - anything else              → every app (fail closed).
//
// A missing or unknown baseline also selects every app: the gate may skip work,
// but it must never skip validation it cannot prove is unnecessary.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'out', 'dist', 'build', '.git', 'coverage', 'test-results']);
const WORKSPACE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']@lumacast\/([a-z0-9][a-z0-9-]*)/g;
const ZERO_SHA = /^0{40}$/;

// Root-level paths that change how every app is validated or built.
const SHARED_FILES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'vitest.config.ts',
  'vitest.setup.ts',
  'playwright.config.ts',
  'playwright.webserver.cjs',
  '.nvmrc',
  '.npmrc',
]);
const SHARED_DIRECTORIES = ['.github', 'tool', 'scripts', 'tests/tool', 'tests/benchmarks'];

// Paths that never change what any app builds or how it is tested.
const DOCUMENTATION_FILES = new Set(['.gitignore', '.gitattributes', '.editorconfig', 'LICENSE', 'LICENSE.md', 'CODEOWNERS']);
const DOCUMENTATION_DIRECTORIES = ['docs', '.claude', '.vscode', '.idea', '.cursor'];

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function isUnder(file, directory) {
  return file === directory || file.startsWith(`${directory}/`);
}

function isWorkspaceDirectory(rootDir, relative) {
  return fs.existsSync(path.join(rootDir, relative, 'package.json'));
}

function listWorkspaces(rootDir, parent) {
  const directory = path.join(rootDir, parent);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isWorkspaceDirectory(rootDir, `${parent}/${entry.name}`))
    .map((entry) => entry.name)
    .sort();
}

/** The app and package workspace names present in the tree. */
export function discoverWorkspaces(rootDir) {
  return { apps: listWorkspaces(rootDir, 'apps'), packages: listWorkspaces(rootDir, 'packages') };
}

function* walkSourceFiles(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      yield* walkSourceFiles(path.join(directory, entry.name));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      yield path.join(directory, entry.name);
    }
  }
}

function declaredWorkspaceDependencies(rootDir, workspaceDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, workspaceDir, 'package.json'), 'utf8'));
  const names = new Set();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith('@lumacast/')) names.add(name.slice('@lumacast/'.length));
    }
  }
  return names;
}

/** Package names a workspace directory imports, from static imports and its manifest. */
export function scanWorkspaceImports(rootDir, workspaceDir) {
  const found = declaredWorkspaceDependencies(rootDir, workspaceDir);
  for (const file of walkSourceFiles(path.join(rootDir, workspaceDir))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(WORKSPACE_IMPORT)) found.add(match[1]);
  }
  return found;
}

/**
 * The workspace dependency graph: each app's transitive package closure and
 * each package's app dependents. `packages` keeps the direct edges for
 * diagnostics.
 */
export function buildDependencyGraph(rootDir) {
  const { apps, packages } = discoverWorkspaces(rootDir);
  const packageSet = new Set(packages);
  const packageEdges = new Map();
  for (const pkg of packages) {
    const imports = scanWorkspaceImports(rootDir, `packages/${pkg}`);
    imports.delete(pkg);
    packageEdges.set(pkg, new Set([...imports].filter((name) => packageSet.has(name))));
  }

  const closureCache = new Map();
  const closureOf = (pkg, trail = new Set()) => {
    if (closureCache.has(pkg)) return closureCache.get(pkg);
    if (trail.has(pkg)) return new Set();
    trail.add(pkg);
    const closure = new Set();
    for (const dependency of packageEdges.get(pkg) ?? []) {
      closure.add(dependency);
      for (const transitive of closureOf(dependency, trail)) closure.add(transitive);
    }
    trail.delete(pkg);
    closureCache.set(pkg, closure);
    return closure;
  };

  const appPackages = new Map();
  for (const app of apps) {
    const direct = [...scanWorkspaceImports(rootDir, `apps/${app}`)].filter((name) => packageSet.has(name));
    const closure = new Set(direct);
    for (const pkg of direct) for (const transitive of closureOf(pkg)) closure.add(transitive);
    appPackages.set(app, closure);
  }

  const dependents = new Map(packages.map((pkg) => [pkg, new Set()]));
  for (const [app, closure] of appPackages) {
    for (const pkg of closure) dependents.get(pkg).add(app);
  }

  return { apps, packages, appPackages, packageEdges, dependents };
}

function scopeAll(reason) {
  return { scope: 'all', apps: [], reason };
}

function scopeNone(reason) {
  return { scope: 'none', apps: [], reason };
}

function scopeApps(apps, reason) {
  return { scope: 'apps', apps: [...apps].sort(), reason };
}

function scopeForPackage(pkg, graph, origin) {
  if (!graph.packages.includes(pkg)) return scopeNone(`${origin} for a package that no longer exists`);
  const apps = graph.dependents.get(pkg);
  if (apps.size === 0) return scopeAll(`${origin}: no app consumes packages/${pkg}, so every app validates it`);
  return scopeApps(apps, `${origin}: packages/${pkg} is consumed by ${[...apps].sort().join(', ')}`);
}

function scopeForApp(app, graph, origin) {
  if (!graph.apps.includes(app)) return scopeNone(`${origin} for an app that no longer exists`);
  return scopeApps([app], origin);
}

/** Which apps a single changed path affects. */
export function classifyChangedFile(file, graph) {
  const relative = toPosix(file).replace(/^\.\//, '');
  const segments = relative.split('/');

  if (SHARED_FILES.has(relative)) return scopeAll('shared root configuration');
  for (const directory of SHARED_DIRECTORIES) {
    if (isUnder(relative, directory)) return scopeAll(`shared tooling under ${directory}/`);
  }
  if (segments[0] === 'apps' && segments.length > 2) return scopeForApp(segments[1], graph, `apps/${segments[1]}`);
  if (segments[0] === 'packages' && segments.length > 2) return scopeForPackage(segments[1], graph, `packages/${segments[1]}`);
  if (segments[0] === 'tests' && segments[1] === 'apps' && segments.length > 3) {
    return scopeForApp(segments[2], graph, `tests/apps/${segments[2]}`);
  }
  if (segments[0] === 'tests' && segments[1] === 'packages' && segments.length > 3) {
    return scopeForPackage(segments[2], graph, `tests/packages/${segments[2]}`);
  }

  // Ownership above wins over the documentation rules: Markdown inside a
  // workspace may be a bundled resource, so it belongs to that workspace.
  if (DOCUMENTATION_FILES.has(relative) || /\.(md|mdx|txt)$/i.test(relative)) return scopeNone('documentation');
  for (const directory of DOCUMENTATION_DIRECTORIES) {
    if (isUnder(relative, directory)) return scopeNone(`documentation or editor configuration under ${directory}/`);
  }

  return scopeAll('unclassified path');
}

/**
 * The apps affected by a set of changed paths. `all` is true when a shared or
 * unclassified path forces every app; `changes` records the per-file decision.
 */
export function affectedAppsFor(changedFiles, graph) {
  const changes = [];
  const selected = new Set();
  let all = false;
  for (const file of changedFiles) {
    const decision = classifyChangedFile(file, graph);
    changes.push({ file: toPosix(file), ...decision });
    if (decision.scope === 'all') all = true;
    for (const app of decision.apps) selected.add(app);
  }
  const apps = all ? [...graph.apps] : [...selected].sort();
  return { apps, all, changes };
}

/** Parse an explicit app selection: `all`, or a comma/space separated list. */
export function parseAppSelection(input, graph) {
  const value = (input ?? '').trim();
  if (value === '' || value === 'all') return [...graph.apps];
  const names = value.split(/[\s,]+/).filter(Boolean);
  const unknown = names.filter((name) => !graph.apps.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown app(s) ${unknown.join(', ')}; expected any of ${graph.apps.join(', ')} or "all".`);
  }
  return graph.apps.filter((app) => names.includes(app));
}

/** The Vitest path filters that cover an app: its tests, its packages' tests, and the shared tool tests. */
export function testPathsFor(app, graph) {
  const packages = [...(graph.appPackages.get(app) ?? [])].sort();
  return [
    `tests/apps/${app}/`,
    ...packages.map((pkg) => `tests/packages/${pkg}/`),
    'tests/tool/',
    'tests/benchmarks/',
  ];
}

function git(rootDir, args) {
  return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commitExists(rootDir, ref) {
  try {
    git(rootDir, ['cat-file', '-e', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Changed paths between the merge base of `base` and `head`, and `head`. Returns
 * `null` when there is no usable baseline (empty, the all-zero SHA of a first
 * push, or a commit this clone does not have), which callers treat as "run
 * everything".
 */
export function changedFilesBetween(rootDir, base, head = 'HEAD') {
  if (!base || ZERO_SHA.test(base) || !commitExists(rootDir, base) || !commitExists(rootDir, head)) return null;
  let mergeBase;
  try {
    mergeBase = git(rootDir, ['merge-base', base, head]);
  } catch {
    return null;
  }
  // With the default head the working tree counts too: locally the question is
  // "what would CI run for what I am about to commit", so unstaged and untracked
  // files are included. In CI the tree is clean, so this equals the commit diff.
  const changed = new Set();
  const collect = (output) => {
    for (const line of output.split('\n')) if (line !== '') changed.add(line);
  };
  if (head === 'HEAD') {
    collect(git(rootDir, ['diff', '--name-only', '--no-renames', mergeBase]));
    collect(git(rootDir, ['ls-files', '--others', '--exclude-standard']));
  } else {
    collect(git(rootDir, ['diff', '--name-only', '--no-renames', mergeBase, head]));
  }
  return [...changed].sort();
}

/**
 * The full decision for one CI run. Exactly one of `apps` (explicit) or
 * `base`/`head` (diff) drives it; an explicit selection never diffs.
 */
export function decideApps({ rootDir, apps, base, head = 'HEAD' }) {
  const graph = buildDependencyGraph(rootDir);
  if (apps !== undefined) {
    const selected = parseAppSelection(apps, graph);
    return { graph, apps: selected, all: selected.length === graph.apps.length, mode: 'explicit', changes: [], baseline: null };
  }
  const changed = changedFilesBetween(rootDir, base, head);
  if (changed === null) {
    return { graph, apps: [...graph.apps], all: true, mode: 'no-baseline', changes: [], baseline: base ?? null };
  }
  const decision = affectedAppsFor(changed, graph);
  return { graph, ...decision, mode: 'diff', baseline: base };
}

function summaryLines(decision) {
  const lines = [];
  if (decision.mode === 'explicit') lines.push(`Explicit selection: ${decision.apps.join(', ') || 'none'}.`);
  else if (decision.mode === 'no-baseline') lines.push(`No usable baseline (${decision.baseline || 'none'}); every app runs.`);
  else {
    lines.push(`${decision.changes.length} changed path(s) since ${decision.baseline}.`);
    for (const change of decision.changes) {
      const target = change.scope === 'all' ? 'every app' : change.scope === 'none' ? 'no app' : change.apps.join(', ');
      lines.push(`- ${change.file} → ${target} (${change.reason})`);
    }
    lines.push(`Selected: ${decision.apps.join(', ') || 'none'}.`);
  }
  return lines;
}

function parseArgs(argv) {
  const options = { format: 'list', head: 'HEAD', rootDir: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} expects a value.`);
      return argv[index];
    };
    if (arg === '--apps') options.apps = next();
    else if (arg === '--base') options.base = next();
    else if (arg === '--head') options.head = next();
    else if (arg === '--format') options.format = next();
    else if (arg === '--root') options.rootDir = path.resolve(next());
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument ${arg}.`);
  }
  return options;
}

const USAGE = `Usage: node tool/ci/affected-apps.mjs [--base <ref>] [--head <ref>] [--apps <list|all>] [--format list|json|github]

  --base    Baseline commit; changed paths are diffed from merge-base(base, head) to head.
            Missing, all-zero, or unknown baselines select every app.
  --head    Head commit (default HEAD).
  --apps    Explicit selection ("all" or a comma-separated list); skips the diff.
  --format  list (default): one app per line; json: the full decision;
            github: <app>=true|false lines plus apps=<json> for $GITHUB_OUTPUT.
`;

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const decision = decideApps(options);
  const lines = summaryLines(decision);
  if (options.format === 'json') {
    const { graph, ...rest } = decision;
    process.stdout.write(`${JSON.stringify({ ...rest, allApps: graph.apps }, null, 2)}\n`);
  } else if (options.format === 'github') {
    for (const app of decision.graph.apps) process.stdout.write(`${app}=${decision.apps.includes(app)}\n`);
    process.stdout.write(`apps=${JSON.stringify(decision.apps)}\n`);
    process.stdout.write(`any=${decision.apps.length > 0}\n`);
    process.stdout.write(`mode=${decision.mode}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Affected apps\n\n${lines.join('\n')}\n`);
    }
  } else {
    for (const app of decision.apps) process.stdout.write(`${app}\n`);
  }
  for (const line of lines) process.stderr.write(`${line}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
