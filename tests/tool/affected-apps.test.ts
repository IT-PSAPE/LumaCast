// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  affectedAppsFor,
  buildDependencyGraph,
  changedFilesBetween,
  classifyChangedFile,
  decideApps,
  parseAppSelection,
  testPathsFor,
} from '../../tool/ci/affected-apps.mjs';

const CLI = fileURLToPath(new URL('../../tool/ci/affected-apps.mjs', import.meta.url));

// A small workspace tree: two apps, a package both import, a package only one
// app imports (through another package), a package nobody imports, and an
// edge the manifest never declared (kernel imports core by static import).
function writeFixture(root: string): void {
  const write = (relative: string, content: string) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  write('package.json', JSON.stringify({ name: 'fixture', workspaces: ['apps/*', 'packages/*'] }));
  write('apps/alpha/package.json', JSON.stringify({ name: '@lumacast/alpha', dependencies: { '@lumacast/ui': '*' } }));
  write('apps/alpha/main/index.ts', "import { x } from '@lumacast/kernel';\nexport const y = x;\n");
  write('apps/beta/package.json', JSON.stringify({ name: '@lumacast/beta' }));
  write('apps/beta/renderer/App.tsx', "import '@lumacast/ui';\nconst lazy = () => import('@lumacast/ui');\nexport { lazy };\n");
  write('packages/ui/package.json', JSON.stringify({ name: '@lumacast/ui' }));
  write('packages/ui/src/index.ts', 'export const ui = 1;\n');
  write('packages/kernel/package.json', JSON.stringify({ name: '@lumacast/kernel' }));
  write('packages/kernel/src/index.ts', "import { core } from '@lumacast/core';\nexport const x = core;\n");
  write('packages/core/package.json', JSON.stringify({ name: '@lumacast/core' }));
  write('packages/core/src/index.ts', 'export const core = 1;\n');
  write('packages/orphan/package.json', JSON.stringify({ name: '@lumacast/orphan' }));
  write('packages/orphan/src/index.ts', 'export const orphan = 1;\n');
  // Ignored trees must not contribute edges.
  write('apps/beta/node_modules/@lumacast/orphan/index.js', "require('@lumacast/orphan');\n");
  write('apps/beta/out/main.js', "require('@lumacast/orphan');\n");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ci',
      GIT_AUTHOR_EMAIL: 'ci@example.invalid',
      GIT_COMMITTER_NAME: 'ci',
      GIT_COMMITTER_EMAIL: 'ci@example.invalid',
    },
  }).trim();
}

describe('affected apps', () => {
  let root: string;
  let graph: ReturnType<typeof buildDependencyGraph>;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-apps-'));
    writeFixture(root);
    graph = buildDependencyGraph(root);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe('dependency graph', () => {
    it('discovers apps and packages from the tree', () => {
      expect(graph.apps).toEqual(['alpha', 'beta']);
      expect(graph.packages).toEqual(['core', 'kernel', 'orphan', 'ui']);
    });

    it('closes each app over static imports, dynamic imports, and declared dependencies', () => {
      expect([...graph.appPackages.get('alpha')!].sort()).toEqual(['core', 'kernel', 'ui']);
      expect([...graph.appPackages.get('beta')!].sort()).toEqual(['ui']);
    });

    it('records an undeclared package-to-package edge from its static import', () => {
      expect([...graph.packageEdges.get('kernel')!]).toEqual(['core']);
    });

    it('ignores node_modules and build output when scanning', () => {
      expect(graph.dependents.get('orphan')!.size).toBe(0);
    });
  });

  describe('classifyChangedFile', () => {
    const scope = (file: string) => classifyChangedFile(file, graph);

    it('maps app files to their app', () => {
      expect(scope('apps/alpha/main/index.ts')).toMatchObject({ scope: 'apps', apps: ['alpha'] });
      expect(scope('apps/beta/README.md')).toMatchObject({ scope: 'apps', apps: ['beta'] });
    });

    it('maps package files to every transitive dependent', () => {
      expect(scope('packages/ui/src/index.ts')).toMatchObject({ scope: 'apps', apps: ['alpha', 'beta'] });
      expect(scope('packages/core/src/index.ts')).toMatchObject({ scope: 'apps', apps: ['alpha'] });
      expect(scope('packages/kernel/package.json')).toMatchObject({ scope: 'apps', apps: ['alpha'] });
    });

    it('treats a package no app consumes as shared so its tests still run', () => {
      expect(scope('packages/orphan/src/index.ts')).toMatchObject({ scope: 'all' });
    });

    it('maps test trees like the source they cover', () => {
      expect(scope('tests/apps/beta/renderer/App.test.tsx')).toMatchObject({ scope: 'apps', apps: ['beta'] });
      expect(scope('tests/packages/core/src/index.test.ts')).toMatchObject({ scope: 'apps', apps: ['alpha'] });
      expect(scope('tests/tool/release-version.test.ts')).toMatchObject({ scope: 'all' });
      expect(scope('tests/benchmarks/fixtures/a.json')).toMatchObject({ scope: 'all' });
    });

    it('treats shared configuration and tooling as affecting every app', () => {
      for (const file of [
        'package.json',
        'package-lock.json',
        'tsconfig.base.json',
        'vitest.config.ts',
        'playwright.config.ts',
        '.nvmrc',
        '.github/workflows/ci.yml',
        'tool/ci/run.mjs',
        'scripts/ensure-rollup-native.cjs',
      ]) {
        expect(scope(file), file).toMatchObject({ scope: 'all' });
      }
    });

    it('treats documentation and editor configuration as affecting no app', () => {
      for (const file of ['README.md', 'docs/ARCHITECTURE.md', 'docs/adr/0001.md', '.gitignore', '.claude/settings.json', 'AGENTS.md']) {
        expect(scope(file), file).toMatchObject({ scope: 'none' });
      }
    });

    it('ignores files of a workspace that no longer exists', () => {
      expect(scope('apps/removed/main.ts')).toMatchObject({ scope: 'none' });
      expect(scope('packages/removed/src/index.ts')).toMatchObject({ scope: 'none' });
    });

    it('fails closed on anything it cannot place', () => {
      expect(scope('mystery/thing.bin')).toMatchObject({ scope: 'all' });
      expect(scope('apps/alpha')).toMatchObject({ scope: 'all' });
    });
  });

  describe('affectedAppsFor', () => {
    it('unions the apps of every changed file', () => {
      const result = affectedAppsFor(['apps/beta/renderer/App.tsx', 'packages/core/src/index.ts', 'docs/x.md'], graph);
      expect(result.apps).toEqual(['alpha', 'beta']);
      expect(result.all).toBe(false);
    });

    it('selects every app once a shared file changes', () => {
      const result = affectedAppsFor(['apps/beta/renderer/App.tsx', 'package-lock.json'], graph);
      expect(result.apps).toEqual(['alpha', 'beta']);
      expect(result.all).toBe(true);
    });

    it('selects no app for a documentation-only change', () => {
      expect(affectedAppsFor(['README.md', 'docs/a.md'], graph)).toMatchObject({ apps: [], all: false });
    });

    it('selects no app for an empty change set', () => {
      expect(affectedAppsFor([], graph)).toMatchObject({ apps: [], all: false });
    });
  });

  describe('parseAppSelection', () => {
    it('accepts "all", an empty value, and comma or space separated lists in tree order', () => {
      expect(parseAppSelection('all', graph)).toEqual(['alpha', 'beta']);
      expect(parseAppSelection('', graph)).toEqual(['alpha', 'beta']);
      expect(parseAppSelection('beta, alpha', graph)).toEqual(['alpha', 'beta']);
      expect(parseAppSelection('beta', graph)).toEqual(['beta']);
    });

    it('rejects unknown app names', () => {
      expect(() => parseAppSelection('alpha,gamma', graph)).toThrow(/gamma/);
    });
  });

  describe('testPathsFor', () => {
    it('covers the app, its transitive packages, and the shared tool tests', () => {
      expect(testPathsFor('alpha', graph)).toEqual([
        'tests/apps/alpha/',
        'tests/packages/core/',
        'tests/packages/kernel/',
        'tests/packages/ui/',
        'tests/tool/',
        'tests/benchmarks/',
      ]);
      expect(testPathsFor('beta', graph)).toEqual(['tests/apps/beta/', 'tests/packages/ui/', 'tests/tool/', 'tests/benchmarks/']);
    });
  });

  describe('git baselines', () => {
    let repo: string;
    let first: string;
    let second: string;
    let third: string;

    beforeAll(() => {
      repo = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-apps-git-'));
      writeFixture(repo);
      git(repo, 'init', '-q', '-b', 'main');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'initial');
      first = git(repo, 'rev-parse', 'HEAD');
      fs.writeFileSync(path.join(repo, 'apps/beta/renderer/App.tsx'), "import '@lumacast/ui';\nexport const changed = 1;\n");
      git(repo, 'commit', '-q', '-am', 'beta change');
      second = git(repo, 'rev-parse', 'HEAD');
      fs.writeFileSync(path.join(repo, 'docs.md'), 'notes\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'docs');
      third = git(repo, 'rev-parse', 'HEAD');
    });

    afterAll(() => {
      fs.rmSync(repo, { recursive: true, force: true });
    });

    it('diffs from the merge base to head', () => {
      expect(changedFilesBetween(repo, first, third)).toEqual(['apps/beta/renderer/App.tsx', 'docs.md']);
      expect(changedFilesBetween(repo, second, third)).toEqual(['docs.md']);
      expect(changedFilesBetween(repo, third, third)).toEqual([]);
    });

    it('includes unstaged and untracked files when head is the working tree', () => {
      const tracked = path.join(repo, 'apps/alpha/main/index.ts');
      const untracked = path.join(repo, 'packages/ui/src/extra.ts');
      const original = fs.readFileSync(tracked, 'utf8');
      try {
        fs.writeFileSync(tracked, `${original}export const dirty = 1;\n`);
        fs.writeFileSync(untracked, 'export const extra = 1;\n');
        expect(changedFilesBetween(repo, third)).toEqual(['apps/alpha/main/index.ts', 'packages/ui/src/extra.ts']);
        expect(changedFilesBetween(repo, third, third)).toEqual([]);
        expect(decideApps({ rootDir: repo, base: third })).toMatchObject({ mode: 'diff', apps: ['alpha', 'beta'] });
      } finally {
        fs.writeFileSync(tracked, original);
        fs.rmSync(untracked, { force: true });
      }
    });

    it('reports no baseline for an empty, all-zero, or unknown ref', () => {
      expect(changedFilesBetween(repo, '', third)).toBeNull();
      expect(changedFilesBetween(repo, '0'.repeat(40), third)).toBeNull();
      expect(changedFilesBetween(repo, 'f'.repeat(40), third)).toBeNull();
    });

    it('decides from the diff, from an explicit selection, or runs everything without a baseline', () => {
      expect(decideApps({ rootDir: repo, base: first, head: third })).toMatchObject({ mode: 'diff', apps: ['beta'], all: false });
      expect(decideApps({ rootDir: repo, base: second, head: third })).toMatchObject({ mode: 'diff', apps: [], all: false });
      expect(decideApps({ rootDir: repo, apps: 'alpha' })).toMatchObject({ mode: 'explicit', apps: ['alpha'], all: false });
      expect(decideApps({ rootDir: repo, base: '0'.repeat(40), head: third })).toMatchObject({ mode: 'no-baseline', apps: ['alpha', 'beta'], all: true });
    });

    it('prints GitHub output lines from the command line', () => {
      const output = execFileSync(process.execPath, [CLI, '--root', repo, '--base', first, '--head', third, '--format', 'github'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(output.split('\n').filter(Boolean)).toEqual(['alpha=false', 'beta=true', 'apps=["beta"]', 'any=true', 'mode=diff']);
    });

    it('lists selected apps one per line by default and fails on unknown apps', () => {
      const output = execFileSync(process.execPath, [CLI, '--root', repo, '--apps', 'beta'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      expect(output).toBe('beta\n');
      expect(() =>
        execFileSync(process.execPath, [CLI, '--root', repo, '--apps', 'gamma'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
      ).toThrow();
    });
  });
});
