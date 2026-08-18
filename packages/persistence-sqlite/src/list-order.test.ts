import { describe, expect, it } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { CastRepository } from './store';
import { createTestRepository } from './test-support';

// The v28 `list-order-index` migration gave `overlays` and `actions` a
// persisted position, and stages/themes finally got a writer for the
// `order_index` they have carried since v8/v4. These are the four
// absolute-position reorders that back the drag-reorderable list panels; they
// share setPlaylistOrder's remove-then-insert semantics, which is what a drop
// index means.

function createOverlay(repo: CastRepository, name: string): Id {
  const patch = repo.createOverlay({ name });
  const overlay = patch.upserts.overlays?.find((candidate) => candidate.name === name);
  if (!overlay) throw new Error(`createOverlay returned no overlay for ${name}`);
  return overlay.id;
}

function overlayNames(repo: CastRepository): string[] {
  return repo.getSnapshot().overlays.slice().sort((a, b) => a.order - b.order).map((overlay) => overlay.name);
}

function overlayOrders(repo: CastRepository): number[] {
  return repo.getSnapshot().overlays.slice().sort((a, b) => a.order - b.order).map((overlay) => overlay.order);
}

function createMacro(repo: CastRepository, name: string): Id {
  const patch = repo.createMacro({ name });
  const macro = patch.upserts.macros?.find((candidate) => candidate.name === name);
  if (!macro) throw new Error(`createMacro returned no macro for ${name}`);
  return macro.id;
}

function macroNames(repo: CastRepository): string[] {
  return repo.getSnapshot().macros.slice().sort((a, b) => a.order - b.order).map((macro) => macro.name);
}

function createStage(repo: CastRepository, name: string): Id {
  const patch = repo.createStage({ name });
  const stage = patch.upserts.stages?.find((candidate) => candidate.name === name);
  if (!stage) throw new Error(`createStage returned no stage for ${name}`);
  return stage.id;
}

function stageNames(repo: CastRepository): string[] {
  return repo.getSnapshot().stages.slice().sort((a, b) => a.order - b.order).map((stage) => stage.name);
}

function createTheme(repo: CastRepository, name: string): Id {
  const patch = repo.createTheme({ name, themeType: 'presentation' });
  const theme = patch.upserts.presentationThemes?.find((candidate) => candidate.name === name);
  if (!theme) throw new Error(`createTheme returned no theme for ${name}`);
  return theme.id;
}

function themeNames(repo: CastRepository): string[] {
  return repo
    .getSnapshot()
    .presentationThemes.slice()
    .sort((a, b) => a.order - b.order)
    .map((theme) => theme.name);
}

describe('CastRepository.setOverlayOrder', () => {
  it('appends new overlays and moves one to an absolute position', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      createOverlay(repo, 'First');
      createOverlay(repo, 'Second');
      const third = createOverlay(repo, 'Third');
      // The seeded demo project ships one overlay ('Watermark') ahead of these.
      expect(overlayNames(repo)).toEqual(['Watermark', 'First', 'Second', 'Third']);

      repo.setOverlayOrder(third, 1);

      expect(overlayNames(repo)).toEqual(['Watermark', 'Third', 'First', 'Second']);
      expect(overlayOrders(repo)).toEqual([0, 1, 2, 3]);
    } finally {
      close();
      cleanup();
    }
  });

  it('clamps an out-of-range target and no-ops an unchanged position', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const first = createOverlay(repo, 'First');
      createOverlay(repo, 'Second');

      repo.setOverlayOrder(first, 99);
      expect(overlayNames(repo).at(-1)).toBe('First');

      const noop = repo.setOverlayOrder(first, overlayNames(repo).length - 1);
      expect(noop.upserts.overlays ?? []).toEqual([]);
    } finally {
      close();
      cleanup();
    }
  });

  it('reports every row it renumbered in the patch, so the renderer can apply it', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      createOverlay(repo, 'First');
      const second = createOverlay(repo, 'Second');

      const patch = repo.setOverlayOrder(second, 0);

      const patched = patch.upserts.overlays ?? [];
      expect(patched.map((overlay) => overlay.name)).toContain('Second');
      expect(patched.find((overlay) => overlay.name === 'Second')?.order).toBe(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unknown overlay id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.setOverlayOrder('no-such-overlay', 0)).toThrow(/Overlay not found: no-such-overlay/);
    } finally {
      close();
      cleanup();
    }
  });

  it('closes the gap left by a delete so positions stay dense', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const first = createOverlay(repo, 'First');
      createOverlay(repo, 'Second');

      repo.deleteOverlay(first);

      expect(overlayOrders(repo)).toEqual([0, 1]);
      expect(overlayNames(repo)).toEqual(['Watermark', 'Second']);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.setMacroOrder', () => {
  it('moves a macro to an absolute position and keeps positions dense', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      createMacro(repo, 'Alpha');
      createMacro(repo, 'Beta');
      const gamma = createMacro(repo, 'Gamma');
      expect(macroNames(repo)).toEqual(['Alpha', 'Beta', 'Gamma']);

      repo.setMacroOrder(gamma, 0);

      expect(macroNames(repo)).toEqual(['Gamma', 'Alpha', 'Beta']);
      expect(repo.getSnapshot().macros.map((macro) => macro.order).sort()).toEqual([0, 1, 2]);
    } finally {
      close();
      cleanup();
    }
  });

  it('renumbers the remaining macros after a delete', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const alpha = createMacro(repo, 'Alpha');
      createMacro(repo, 'Beta');
      createMacro(repo, 'Gamma');

      repo.deleteMacro(alpha);

      expect(macroNames(repo)).toEqual(['Beta', 'Gamma']);
      expect(repo.getSnapshot().macros.map((macro) => macro.order).sort()).toEqual([0, 1]);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unknown macro id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.setMacroOrder('no-such-macro', 0)).toThrow(/Macro not found: no-such-macro/);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.setStageOrder', () => {
  it('moves a stage and renumbers densely, including after a delete', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const audience = createStage(repo, 'Audience');
      createStage(repo, 'Stage Left');
      const confidence = createStage(repo, 'Confidence');

      repo.setStageOrder(confidence, 0);
      expect(stageNames(repo).slice(0, 1)).toEqual(['Confidence']);

      repo.deleteStage(audience);
      expect(repo.getSnapshot().stages.map((stage) => stage.order).sort()).toEqual(
        repo.getSnapshot().stages.map((_stage, index) => index),
      );
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unknown stage id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.setStageOrder('no-such-stage', 0)).toThrow(/Stage not found: no-such-stage/);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.setThemeOrder', () => {
  it('reorders within one theme family only (#219 decision D2)', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      createTheme(repo, 'Brand A');
      const brandB = createTheme(repo, 'Brand B');
      const lyricPatch = repo.createTheme({ name: 'Lyric Look', themeType: 'lyric' });
      const lyricTheme = lyricPatch.upserts.lyricThemes?.[0];
      const lyricOrderBefore = lyricTheme?.order;

      const patch = repo.setThemeOrder(brandB, 'presentation', 0);

      expect(themeNames(repo).slice(0, 1)).toEqual(['Brand B']);
      // The other three tables are untouched — nothing leaks across families.
      expect(patch.upserts.lyricThemes).toBeUndefined();
      expect(repo.getSnapshot().lyricThemes.find((theme) => theme.id === lyricTheme?.id)?.order).toBe(lyricOrderBefore);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unknown theme id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.setThemeOrder('no-such-theme', 'presentation', 0)).toThrow(/Theme not found: no-such-theme/);
    } finally {
      close();
      cleanup();
    }
  });
});
