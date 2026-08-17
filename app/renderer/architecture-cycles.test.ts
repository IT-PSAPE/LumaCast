import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// tool/check_electron_architecture.mjs is a plain checked-in script with no
// declaration file, so this test imports its `check` export as `any` and
// narrows it locally to just the shape this test relies on.
// @ts-expect-error -- no .d.ts for this checked-in .mjs script
import { check as uncheckedCheck } from '../../tool/check_electron_architecture.mjs';

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

// Regression coverage for #157: the renderer used to have two bidirectional
// feature dependencies — canvas<->playback (NDI capture-source registration)
// and canvas<->inspector (inspector-tab switching after a canvas drop) — that
// the checker reported as feature-cycle refactor debt. Both edges in the
// canvas-outbound direction were removed:
//   - scene-stage.tsx now publishes its capture canvas through the shared,
//     feature-agnostic app/renderer/rendering/capture-surface-registry.ts
//     instead of calling playback's ndi-capture-source.ts directly.
//   - use-stage-viewport-controller.ts now reads/writes the inspector tab
//     through the shared app/renderer/contexts/workbench-context.tsx instead
//     of importing the inspector feature's useInspector() facade.
// These tests assert the specific edges stay gone against the real
// committed tree, and separately prove the checker's cycle/one-direction
// detection itself is sound using small synthetic fixture trees (so the
// real-tree assertions can't pass merely because the detector is broken).

describe('canvas feature no longer cycles with playback or inspector (real tree)', () => {
  it('reports no feature-cycle violation between canvas and playback', () => {
    const result = check({});
    const cycle = result.violations.find(
      (v) =>
        v.rule === 'feature-cycle' &&
        [v.from, v.to].includes('app/renderer/features/canvas') &&
        [v.from, v.to].includes('app/renderer/features/playback'),
    );
    expect(cycle).toBeUndefined();
  });

  it('reports no feature-cycle violation between canvas and inspector', () => {
    const result = check({});
    const cycle = result.violations.find(
      (v) =>
        v.rule === 'feature-cycle' &&
        [v.from, v.to].includes('app/renderer/features/canvas') &&
        [v.from, v.to].includes('app/renderer/features/inspector'),
    );
    expect(cycle).toBeUndefined();
  });

  it('reports no canvas -> playback cross-feature import at all', () => {
    const result = check({});
    const outbound = result.violations.find(
      (v) =>
        v.rule === 'feature-isolation' &&
        v.from.startsWith('app/renderer/features/canvas/') &&
        typeof v.to === 'string' &&
        v.to.startsWith('app/renderer/features/playback/'),
    );
    expect(outbound).toBeUndefined();
  });

  it('reports no canvas -> inspector cross-feature import at all', () => {
    const result = check({});
    const outbound = result.violations.find(
      (v) =>
        v.rule === 'feature-isolation' &&
        v.from.startsWith('app/renderer/features/canvas/') &&
        typeof v.to === 'string' &&
        v.to.startsWith('app/renderer/features/inspector/'),
    );
    expect(outbound).toBeUndefined();
  });

  it('still allows the one remaining direction: playback and inspector may still import canvas', () => {
    // The fix only had to remove the canvas-outbound edge; playback and
    // inspector depending on canvas (program-panel.tsx -> SceneStage,
    // ndi-frame-capture.tsx -> scene-node-shape/scene-types,
    // use-shape-inspector.ts -> align-element-draft) is a one-directional
    // feature dependency, not a cycle, and stays untouched by this fix.
    const result = check({});
    const playbackToCanvas = result.violations.some(
      (v) =>
        v.rule === 'feature-isolation' &&
        v.from.startsWith('app/renderer/features/playback/') &&
        typeof v.to === 'string' &&
        v.to.startsWith('app/renderer/features/canvas/'),
    );
    const inspectorToCanvas = result.violations.some(
      (v) =>
        v.rule === 'feature-isolation' &&
        v.from.startsWith('app/renderer/features/inspector/') &&
        typeof v.to === 'string' &&
        v.to.startsWith('app/renderer/features/canvas/'),
    );
    expect(playbackToCanvas).toBe(true);
    expect(inspectorToCanvas).toBe(true);
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
    writeFile(tmpRoot, 'app/renderer/features/alpha/a.ts', "import { b } from '../beta/b';\nexport const a = b;\n");
    writeFile(tmpRoot, 'app/renderer/features/beta/b.ts', "import { a } from '../alpha/a';\nexport const b = 1;\nvoid a;\n");

    const result = check({ rootDir: tmpRoot, allowList: [] });

    expect(result.violations.some((v) => v.rule === 'feature-cycle')).toBe(true);
  });

  it('does not flag a one-directional feature dependency as feature-cycle', () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), 'arch-nocycle-'));
    writeFile(tmpRoot, 'app/renderer/features/alpha/a.ts', "import { b } from '../beta/b';\nexport const a = b;\n");
    writeFile(tmpRoot, 'app/renderer/features/beta/b.ts', 'export const b = 1;\n');

    const result = check({ rootDir: tmpRoot, allowList: [] });

    expect(result.violations.some((v) => v.rule === 'feature-cycle')).toBe(false);
    // The one surviving direction is still reported as refactor debt, not a
    // hard failure — matches how playback/inspector -> canvas is treated.
    expect(
      result.violations.some(
        (v) => v.rule === 'feature-isolation' && v.from === 'app/renderer/features/alpha/a.ts',
      ),
    ).toBe(true);
    expect(result.ok).toBe(true);
  });
});
