import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tool/check_electron_architecture.mjs is a plain checked-in script with no
// declaration file, so this test imports its exports as `any` and narrows them
// locally to just the shape this test relies on.
// @ts-expect-error -- no .d.ts for this checked-in .mjs script
import { check as uncheckedCheck } from '../../tool/check_electron_architecture.mjs';

interface ArchitectureViolation {
  rule: string;
  from: string;
  to: string | null;
  line: number;
  detail: string;
}
interface ArchitectureCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: { files: number; edges: number; exceptionsUsed: number };
  violations: ArchitectureViolation[];
}
const check = uncheckedCheck as (options?: { rootDir?: string; allowList?: [] }) => ArchitectureCheckResult;

const CHECKER = fileURLToPath(new URL('../../tool/check_electron_architecture.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../../tool/fixtures/electron-architecture/scenarios', import.meta.url));

function fixture(...parts: string[]) {
  return path.join(FIXTURES, ...parts);
}

function rulesIn(result: ArchitectureCheckResult) {
  return result.violations.map((v) => `${v.rule} ${v.from} -> ${v.to} ${v.detail}`).join('\n');
}

// Regression coverage for the checker's own correctness, as distinct from the
// fixture graph suite that `npm run test:architecture` runs. Each test here
// pins a defect that made the checker report the wrong thing, in a way the
// pass/fail scenario list cannot express.

describe('checker source hygiene', () => {
  it('carries no raw NUL byte in its source', () => {
    // The package public-entry cache was keyed on a template literal containing
    // a literal NUL. It happened to be unique, but it made the file
    // un-lintable and unreadable in review; the key is an escape sequence now.
    const source = readFileSync(CHECKER, 'utf8');
    expect(source.includes('\u0000')).toBe(false);
  });
});

describe('root normalization', () => {
  it('reports the same result for a relative and an absolute rootDir', () => {
    // check() resolves rootDir once, so a relative `--root .` walks the same
    // files, populates the public-entry cache with the same absolute keys, and
    // yields the same violations as the absolute path.
    const absolute = fixture('monorepo', 'package-entry-map-not-public');
    const relative = path.relative(process.cwd(), absolute);

    expect(path.isAbsolute(relative)).toBe(false);
    const fromRelative = check({ rootDir: relative, allowList: [] });
    const fromAbsolute = check({ rootDir: absolute, allowList: [] });

    expect(rulesIn(fromRelative)).toBe(rulesIn(fromAbsolute));
    expect(fromRelative.violations.length).toBeGreaterThan(0);
  });
});

describe('package public surface', () => {
  it('treats a second TypeScript file in the export map as internal', () => {
    // `exports: { "./deep": "./src/deep/thing.ts" }` does not publish a second
    // entry point; the package's only public source entry is src/index.ts.
    const result = check({ rootDir: fixture('monorepo', 'package-entry-map-not-public'), allowList: [] });

    expect(result.ok).toBe(false);
    const violation = result.violations.find(
      (v) => v.rule === 'package-public-entry' && v.to === 'packages/widget/src/deep/thing.ts',
    );
    expect(violation).toBeDefined();
    expect(violation?.detail).toContain('not a public entry point of @lumacast/widget');
  });

  it('accepts a stylesheet the export map names, and only that one', () => {
    // The one asset exception: `@lumacast/ui/theme.css` is declared in
    // `exports`, so it is importable by subpath.
    const declared = check({ rootDir: fixture('monorepo', 'ui-allowed'), allowList: [] });
    expect(declared.violations.filter((v) => v.rule === 'package-public-entry')).toEqual([]);

    // `style` and `unpkg` are bundler hints, not a declaration, so a package's
    // stylesheet is a deep import like anything else until `exports` names it.
    const undeclared = check({ rootDir: fixture('monorepo', 'package-asset-not-declared'), allowList: [] });
    expect(undeclared.ok).toBe(false);
    const violation = undeclared.violations.find(
      (v) => v.rule === 'package-public-entry' && v.to === 'packages/widget/theme.css',
    );
    expect(violation).toBeDefined();
  });
});

describe('app-scoped alias strictness', () => {
  it('reports an alias that resolves in no app instead of borrowing a sibling', () => {
    // `@renderer/components/thing` exists in cast but not in the importing app.
    // The alias resolves inside the importing app only, so the neighbour's file
    // is irrelevant and a miss is an error of its own.
    const result = check({ rootDir: fixture('monorepo', 'app-alias-no-sibling-fallback'), allowList: [] });

    expect(result.ok).toBe(false);
    const violations = result.violations.filter((v) => v.rule === 'app-isolation');
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.from)).toEqual([
      'apps/cloud/renderer/main.tsx',
      'apps/cloud/renderer/main.tsx',
    ]);
    expect(violations[0].detail).toContain('resolves only inside the importing app');
    expect(violations[1].detail).toContain('resolves only inside the importing app');
    // Nothing resolved into cast, so no violation names a cast file.
    expect(violations.some((v) => String(v.to).startsWith('apps/cast/'))).toBe(false);
  });
});

describe('.js and .cjs are code', () => {
  it('applies renderer and package rules to JavaScript source files', () => {
    // Classified as an asset, both files were skipped entirely: the renderer's
    // .js file could import electron and the package's .cjs file could import
    // electron without a single violation.
    const result = check({ rootDir: fixture('js-is-code'), allowList: [] });

    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) => v.rule === 'renderer-isolation' && v.from === 'apps/cast/renderer/main.js' && v.to === 'electron',
      ),
    ).toBe(true);
    expect(
      result.violations.some(
        (v) => v.rule === 'package-purity' && v.from === 'packages/widget/src/legacy.cjs' && v.to === 'electron',
      ),
    ).toBe(true);
  });
});

describe('packages may not name an app as a module', () => {
  it('reports @lumacast/<app> and @workspace/<app> specifiers from a package', () => {
    const result = check({ rootDir: fixture('monorepo', 'package-to-app-module-specifier'), allowList: [] });

    expect(result.ok).toBe(false);
    const specs = result.violations
      .filter((v) => v.rule === 'package-app-boundary')
      .map((v) => v.to);
    expect(specs).toContain('@lumacast/cast/renderer/thing');
    expect(specs).toContain('@lumacast/flux/renderer/thing');
    expect(specs).toContain('@lumacast/cloud/renderer/thing');
    expect(specs).toContain('@workspace/flux/renderer/thing');
  });
});
