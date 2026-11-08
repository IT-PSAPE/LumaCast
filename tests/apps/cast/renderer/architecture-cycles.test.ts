import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// tool/check_electron_architecture.mjs is a plain checked-in script with no
// declaration file, so this test imports its `check` export as `any` and
// narrows it locally to just the shape this test relies on.
// @ts-expect-error -- no .d.ts for this checked-in .mjs script
import { check as uncheckedCheck } from '../../../../tool/check_electron_architecture.mjs';

interface ArchitectureViolation {
  rule: string;
  from: string;
  to: string | null;
  line: number;
  detail: string;
}
interface ArchitectureAllowListEntry {
  from: string;
  to: string;
  rules: string[];
  reason: string;
  removedBy: string;
}
interface ArchitectureCheckOptions {
  rootDir?: string;
  allowList?: ArchitectureAllowListEntry[];
}
interface ArchitectureCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: { files: number; edges: number; exceptionsUsed: number };
  violations: ArchitectureViolation[];
}
const check = uncheckedCheck as (options?: ArchitectureCheckOptions) => ArchitectureCheckResult;

// Regression coverage for Cast feature boundaries. Canvas rendering is shared
// through renderer/rendering, and feature integrations are composed by screens
// or the application shell. These tests keep playback and inspector from
// depending directly on the canvas feature, and separately prove that the
// checker's cycle/one-direction detection works with synthetic fixture trees.

describe('canvas feature no longer cycles with playback or inspector (real tree)', () => {
  it('reports no feature-cycle violation between canvas and playback', () => {
    const result = check({});
    const cycle = result.violations.find(
      (v) =>
        v.rule === 'feature-cycle' &&
        [v.from, v.to].includes('apps/cast/renderer/features/canvas') &&
        [v.from, v.to].includes('apps/cast/renderer/features/playback'),
    );
    expect(cycle).toBeUndefined();
  });

  it('reports no feature-cycle violation between canvas and inspector', () => {
    const result = check({});
    const cycle = result.violations.find(
      (v) =>
        v.rule === 'feature-cycle' &&
        [v.from, v.to].includes('apps/cast/renderer/features/canvas') &&
        [v.from, v.to].includes('apps/cast/renderer/features/inspector'),
    );
    expect(cycle).toBeUndefined();
  });

  it('reports no canvas -> playback cross-feature import at all', () => {
    const result = check({});
    const outbound = result.violations.find(
      (v) =>
        v.rule === 'feature-isolation' &&
        v.from.startsWith('apps/cast/renderer/features/canvas/') &&
        typeof v.to === 'string' &&
        v.to.startsWith('apps/cast/renderer/features/playback/'),
    );
    expect(outbound).toBeUndefined();
  });

  it('reports no canvas -> inspector cross-feature import at all', () => {
    const result = check({});
    const outbound = result.violations.find(
      (v) =>
        v.rule === 'feature-isolation' &&
        v.from.startsWith('apps/cast/renderer/features/canvas/') &&
        typeof v.to === 'string' &&
        v.to.startsWith('apps/cast/renderer/features/inspector/'),
    );
    expect(outbound).toBeUndefined();
  });

  it('keeps playback and inspector independent of the canvas feature', () => {
    const result = check({});
    const playbackToCanvas = result.violations.some(
      (v) =>
        v.rule === 'feature-isolation' &&
        v.from.startsWith('apps/cast/renderer/features/playback/') &&
        typeof v.to === 'string' &&
        v.to.startsWith('apps/cast/renderer/features/canvas/'),
    );
    const inspectorToCanvas = result.violations.some(
      (v) =>
        v.rule === 'feature-isolation' &&
        v.from.startsWith('apps/cast/renderer/features/inspector/') &&
        typeof v.to === 'string' &&
        v.to.startsWith('apps/cast/renderer/features/canvas/'),
    );
    expect(playbackToCanvas).toBe(false);
    expect(inspectorToCanvas).toBe(false);
  });
});

// ─── Synthetic fixtures: prove the detector itself is sound ────────────
//
// tool/fixtures/electron-architecture/ is owned by #156 and out of this
// issue's write boundary, so these scenarios are built as throwaway temp
// directories rather than new checked-in fixtures.

function writeFile(root: string, rel: string, contents: string) {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

describe('architecture checker cycle/one-direction detection (synthetic fixtures)', () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('flags a bidirectional feature dependency as feature-cycle', () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'arch-cycle-'));
    writeFile(tmpRoot, 'apps/cast/renderer/features/alpha/a.ts', "import { b } from '../beta/b';\nexport const a = b;\n");
    writeFile(tmpRoot, 'apps/cast/renderer/features/beta/b.ts', "import { a } from '../alpha/a';\nexport const b = 1;\nvoid a;\n");

    const result = check({ rootDir: tmpRoot, allowList: [] });

    expect(result.violations.some((v) => v.rule === 'feature-cycle')).toBe(true);
  });

  it('rejects a one-directional feature dependency without calling it a cycle', () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'arch-nocycle-'));
    writeFile(tmpRoot, 'apps/cast/renderer/features/alpha/a.ts', "import { b } from '../beta/b';\nexport const a = b;\n");
    writeFile(tmpRoot, 'apps/cast/renderer/features/beta/b.ts', 'export const b = 1;\n');

    const result = check({ rootDir: tmpRoot, allowList: [] });

    expect(result.violations.some((v) => v.rule === 'feature-cycle')).toBe(false);
    // A feature edge is a hard boundary violation even when it is not a cycle.
    expect(
      result.violations.some(
        (v) => v.rule === 'feature-isolation' && v.from === 'apps/cast/renderer/features/alpha/a.ts',
      ),
    ).toBe(true);
    expect(result.ok).toBe(false);
  });
});
