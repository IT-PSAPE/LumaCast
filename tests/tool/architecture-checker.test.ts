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

describe("flux photo packages", () => {
  it("permits the recorded one-way stack and a renderer that holds the domain model", () => {
    // photo-model -> kernel; photo-imaging -> kernel/photo-model;
    // photo-library -> kernel/photo-model/photo-imaging. Main owns the Node-side
    // packages; the renderer holds photo-model, shared UI, and the typed
    // apps/flux/shared DesktopAPI contract.
    const result = check({
      rootDir: fixture("photo", "allowed"),
      allowList: [],
    });

    expect(rulesIn(result)).toBe("");
    expect(result.ok).toBe(true);
  });

  it("denies reverse and off-stack photo edges", () => {
    // photo-model -> photo-imaging and photo-imaging -> photo-library are
    // reverse edges; photo-library -> composition leaves the photo stack.
    const result = check({
      rootDir: fixture("photo", "direction-denied"),
      allowList: [],
    });

    expect(result.ok).toBe(false);
    const denied = result.violations.filter(
      (v) => v.rule === "package-dependency-direction",
    );
    expect(denied.map((v) => `${v.from} -> ${v.to}`).sort()).toEqual(
      [
        "packages/photo-model/src/index.ts -> packages/photo-imaging/src/index.ts",
        "packages/photo-imaging/src/index.ts -> packages/photo-library/src/index.ts",
        "packages/photo-library/src/index.ts -> packages/composition/src/index.ts",
      ].sort(),
    );
  });

  it("keeps a photo package reachable only through its public entry point", () => {
    // The renderer may use photo-model, but not a deep import into its source.
    const result = check({
      rootDir: fixture("photo", "deep-import-denied"),
      allowList: [],
    });

    expect(result.ok).toBe(false);
    const violation = result.violations.find(
      (v) =>
        v.rule === "package-public-entry" &&
        v.from === "apps/flux/renderer/main.tsx" &&
        v.to === "packages/photo-model/src/internal/metadata.ts",
    );
    expect(violation?.detail).toContain(
      "not a public entry point of @lumacast/photo-model",
    );
  });

  it("denies a photo package importing app code", () => {
    const result = check({
      rootDir: fixture("photo", "app-import-denied"),
      allowList: [],
    });

    expect(result.ok).toBe(false);
    expect(
      result.violations.some(
        (v) =>
          v.rule === "package-app-boundary" &&
          v.from === "packages/photo-model/src/app-link.ts" &&
          v.to === "apps/flux/main/index.ts",
      ),
    ).toBe(true);
  });

  it("bans the Node-side photo packages from every renderer", () => {
    // photo-imaging and photo-library are decode/filesystem work. The split is
    // not flux-local: cloud's renderer is denied the same import.
    const result = check({
      rootDir: fixture("photo", "renderer-node-denied"),
      allowList: [],
    });

    expect(result.ok).toBe(false);
    const denied = result.violations.filter(
      (v) => v.rule === "photo-renderer-boundary",
    );
    expect(denied.map((v) => `${v.from} -> ${v.to}`).sort()).toEqual(
      [
        "apps/flux/renderer/main.tsx -> packages/photo-imaging/src/index.ts",
        "apps/cloud/renderer/main.tsx -> packages/photo-library/src/index.ts",
      ].sort(),
    );
    expect(denied[0].detail).toContain("@lumacast/photo-model");
  });

  it("denies a renderer naming a Node-side photo package that does not resolve to a file", () => {
    // Neither specifier here resolves: one names a subpath that does not exist,
    // the other names a package that is not installed at all. Both are still
    // judged by the package they name, so the rule cannot be dodged by choosing
    // a specifier that fails to resolve.
    const result = check({
      rootDir: fixture("photo", "renderer-named-denied"),
      allowList: [],
    });

    expect(result.ok).toBe(false);
    const denied = result.violations.filter(
      (v) => v.rule === "photo-renderer-boundary",
    );
    expect(denied.map((v) => v.to).sort()).toEqual(
      [
        "@lumacast/photo-imaging/internal/decode",
        "@lumacast/photo-library",
      ].sort(),
    );
    for (const violation of denied) {
      expect(violation.from).toBe("apps/flux/renderer/main.tsx");
      expect(violation.detail).toContain("@lumacast/photo-model");
    }
  });

  it("does not confuse an unrelated photo-imaging package with @lumacast/photo-imaging", () => {
    // A third-party package that happens to share the name is not the Flux
    // Node-side imaging layer, so the renderer/Node split does not apply and
    // the import is left to the ordinary external rules.
    const result = check({
      rootDir: fixture("photo", "renderer-named-denied"),
      allowList: [],
    });

    const fromThirdParty = result.violations.filter(
      (v) => v.from === "apps/flux/renderer/third-party.ts",
    );
    expect(fromThirdParty).toEqual([]);
  });

  it("keeps Node builtins out of the renderer-safe model but not the Node-side packages", () => {
    // photo-model is the one photo package a renderer may hold, so importing
    // node:fs there would make the renderer need a Node runtime. The unprefixed
    // `fs` names the same builtin and is denied identically. photo-imaging is
    // Node code by design and is not denied the same import.
    const result = check({
      rootDir: fixture("photo", "model-node-purity"),
      allowList: [],
    });

    expect(result.ok).toBe(false);
    const impure = result.violations.filter((v) => v.rule === "package-purity");
    expect(impure.map((v) => `${v.from} -> ${v.to}`)).toEqual([
      "packages/photo-model/src/index.ts -> fs",
      "packages/photo-model/src/index.ts -> node:fs",
    ]);
    expect(impure[0].detail).toContain("renderer-safe");
  });

  it("keeps React and Electron out of a photo package", () => {
    const result = check({
      rootDir: fixture("photo", "headless-purity"),
      allowList: [],
    });

    expect(result.ok).toBe(false);
    const impure = result.violations.filter((v) => v.rule === "package-purity");
    expect(impure.map((v) => v.to).sort()).toEqual(["electron", "react"]);
  });
});

describe("app shared contract zone", () => {
  it("denies the typed contract module depending on main or renderer code", () => {
    // apps/flux/shared holds the DesktopAPI contract: both sides import it, it
    // imports neither.
    const result = check({
      rootDir: fixture("shared", "forbidden"),
      allowList: [],
    });

    expect(result.ok).toBe(false);
    const violations = result.violations.filter(
      (v) => v.rule === "shared-contract",
    );
    expect(violations.map((v) => v.to).sort()).toEqual(
      ["apps/flux/main/index.ts", "apps/flux/renderer/entry.ts"].sort(),
    );
  });

  it("keeps the contract module free of Node builtins, Electron, and the Node-side photo packages", () => {
    // Both processes import the contract, so anything that pins it to one
    // process's runtime leaks into the other: node:fs and electron are process
    // code, and photo-imaging is Node-side image work that crosses the
    // contract as data instead. The unprefixed `path` is the same denial.
    const result = check({
      rootDir: fixture("shared", "builtin-denied"),
      allowList: [],
    });

    expect(result.ok).toBe(false);
    const violations = result.violations.filter(
      (v) => v.rule === "shared-contract",
    );
    expect(violations.map((v) => v.to).sort()).toEqual(
      ["path", "node:fs", "electron", "packages/photo-imaging/src/index.ts"].sort(),
    );
    for (const violation of violations) {
      expect(violation.from).toBe("apps/flux/shared/desktop-api.ts");
    }
  });

  it("lets main and renderer both depend on their own contract and the domain model", () => {
    // The contract is the one surface the two sides meet on, so importing it is
    // allowed from each; only what the contract itself reaches is denied.
    const result = check({
      rootDir: fixture("shared", "builtin-denied"),
      allowList: [],
    });

    const permitted = result.violations.filter(
      (v) => v.from === "apps/flux/shared/desktop-api.ts",
    );
    expect(permitted.map((v) => v.to)).not.toContain("apps/flux/main/index.ts");
    expect(permitted.map((v) => v.to)).not.toContain(
      "apps/flux/renderer/entry.ts",
    );
  });
});
