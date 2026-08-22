import { describe, expect, it, vi } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import { createTestRepository } from './test-support';
import type { CastRepository } from './store';

function collectSqlExecutions(repo: CastRepository) {
  const db = (repo as unknown as { db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => unknown } } }).db;
  const originalPrepare = db.prepare.bind(db);
  const executions = new Map<string, number>();
  let totalExecutions = 0;
  let readExecutions = 0;
  let writeExecutions = 0;
  const instrumented = new WeakSet<object>();

  const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    const statement = originalPrepare(sql);
    if (!instrumented.has(statement as object)) {
      instrumented.add(statement as object);
      for (const method of ['all', 'get', 'run'] as const) {
        const originalMethod = statement[method].bind(statement);
        vi.spyOn(statement, method).mockImplementation((...args: unknown[]) => {
          totalExecutions += 1;
          if (method === 'run') writeExecutions += 1;
          else readExecutions += 1;
          executions.set(sql, (executions.get(sql) ?? 0) + 1);
          return originalMethod(...args);
        });
      }
    }
    return statement;
  });

  return {
    executions,
    getTotalExecutions: () => totalExecutions,
    getReadExecutions: () => readExecutions,
    getWriteExecutions: () => writeExecutions,
    restore: () => prepareSpy.mockRestore(),
  };
}

function countSqlExecutionsMatching(executions: ReadonlyMap<string, number>, pattern: RegExp): number {
  let count = 0;
  for (const [sql, executionsForStatement] of executions) {
    if (pattern.test(sql.replace(/\s+/g, ' ').trim())) {
      count += executionsForStatement;
    }
  }
  return count;
}

function failOnPrepare(target: CastRepository, match: string, occurrence = 1): () => void {
  const db = (target as unknown as { db: { prepare: (sql: string) => unknown } }).db;
  const original = db.prepare.bind(db);
  let seen = 0;
  const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    if (sql.includes(match)) {
      seen += 1;
      if (seen === occurrence) {
        throw new Error(`forced failure: ${match} #${occurrence}`);
      }
    }
    return original(sql);
  });
  return () => spy.mockRestore();
}

function makeThemeElement(id: Id, text: string, zIndex: number): SlideElement {
  const now = new Date().toISOString();
  return {
    id,
    slideId: '',
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    rotation: 0,
    opacity: 1,
    zIndex,
    layer: 'content',
    payload: {
      text,
      fontFamily: 'Avenir Next',
      fontSize: 48,
      color: '#FFFFFF',
      alignment: 'left',
      weight: '400',
    },
    createdAt: now,
    updatedAt: now,
  };
}

const SQLITE_VARIABLE_LIMIT_BOUNDARY = 1005;

describe('Issue #240 repository regressions', () => {
  it('builds cue, macro, and trigger-binding patches from direct id reads instead of full-table scans', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const cueSql = collectSqlExecutions(repo);
      const cuePatch = repo.createCue({ kind: 'overlay.clearAll', payload: {} });
      cueSql.restore();
      expect(cuePatch.upserts.cues).toHaveLength(1);
      expect(countSqlExecutionsMatching(cueSql.executions, /FROM cues ORDER BY updated_at DESC/)).toBe(0);
      expect(countSqlExecutionsMatching(cueSql.executions, /FROM cues WHERE id IN \(\?\)/)).toBe(1);

      const cueId = cuePatch.upserts.cues![0]!.id;
      const macroSql = collectSqlExecutions(repo);
      const macroPatch = repo.createMacro({
        name: 'Macro',
        description: '',
        cues: [{ cueId, orderIndex: 0, delayBeforeMs: 0, delayAfterMs: 0 }],
      });
      macroSql.restore();
      expect(macroPatch.upserts.macros).toHaveLength(1);
      expect(countSqlExecutionsMatching(macroSql.executions, /FROM actions ORDER BY order_index ASC/)).toBe(0);
      expect(countSqlExecutionsMatching(macroSql.executions, /FROM actions WHERE id IN \(\?\)/)).toBe(1);

      const macroId = macroPatch.upserts.macros![0]!.id;
      const bindingSql = collectSqlExecutions(repo);
      const bindingPatch = repo.createTriggerBinding({
        triggerType: 'slide.take',
        sourceId: 'KeyK',
        targetType: 'macro',
        targetId: macroId,
        config: {},
      });
      bindingSql.restore();
      expect(bindingPatch.upserts.triggerBindings).toHaveLength(1);
      expect(countSqlExecutionsMatching(bindingSql.executions, /FROM trigger_bindings ORDER BY created_at ASC/)).toBe(0);
      expect(countSqlExecutionsMatching(bindingSql.executions, /FROM trigger_bindings WHERE id IN \(\?\)/)).toBe(1);
    } finally {
      close();
      cleanup();
    }
  });

  it('deletes a cue after dependent macro steps and cue bindings are removed, preserving FK validity and patch semantics', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const cueId = repo.createCue({ kind: 'overlay.clearAll', payload: {} }).upserts.cues![0]!.id;
      const macroId = repo.createMacro({
        name: 'Macro',
        description: '',
        cues: [{ cueId, orderIndex: 0, delayBeforeMs: 0, delayAfterMs: 0 }],
      }).upserts.macros![0]!.id;
      const bindingId = repo.createTriggerBinding({
        triggerType: 'slide.take',
        sourceId: 'KeyC',
        targetType: 'cue',
        targetId: cueId,
        config: {},
      }).upserts.triggerBindings![0]!.id;

      const patch = repo.deleteCue(cueId);
      const snapshot = repo.getSnapshot();
      const foreignKeyViolations = (repo as unknown as {
        db: { prepare: (sql: string) => { all: () => unknown[] } };
      }).db.prepare('PRAGMA foreign_key_check').all();

      expect(patch.deletes.cues).toEqual([cueId]);
      expect(patch.deletes.triggerBindings).toEqual([bindingId]);
      expect(patch.upserts.macros?.map((macro) => macro.id)).toEqual([macroId]);
      expect(snapshot.cues.some((cue) => cue.id === cueId)).toBe(false);
      expect(snapshot.macros.find((macro) => macro.id === macroId)?.cues).toHaveLength(0);
      expect(snapshot.triggerBindings.some((binding) => binding.id === bindingId)).toBe(false);
      expect(foreignKeyViolations).toEqual([]);
    } finally {
      close();
      cleanup();
    }
  });

  it('rolls back cue deletion if cleanup fails after macro steps were removed but before the parent cue is deleted', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const cueId = repo.createCue({ kind: 'overlay.clearAll', payload: {} }).upserts.cues![0]!.id;
      const macroId = repo.createMacro({
        name: 'Macro',
        description: '',
        cues: [{ cueId, orderIndex: 0, delayBeforeMs: 0, delayAfterMs: 0 }],
      }).upserts.macros![0]!.id;
      repo.createTriggerBinding({
        triggerType: 'slide.take',
        sourceId: 'KeyC',
        targetType: 'cue',
        targetId: cueId,
        config: {},
      });

      const restore = failOnPrepare(repo, "DELETE FROM trigger_bindings WHERE target_type = 'cue' AND target_id = ?");
      try {
        expect(() => repo.deleteCue(cueId)).toThrow(/forced failure/);
      } finally {
        restore();
      }

      const snapshot = repo.getSnapshot();
      expect(snapshot.cues.some((cue) => cue.id === cueId)).toBe(true);
      expect(snapshot.macros.find((macro) => macro.id === macroId)?.cues).toHaveLength(1);
      expect(snapshot.triggerBindings.some((binding) => binding.targetType === 'cue' && binding.targetId === cueId)).toBe(true);
    } finally {
      close();
      cleanup();
    }
  });

  it('rolls back macro deletion if a later delete step fails', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const cueId = repo.createCue({ kind: 'overlay.clearAll', payload: {} }).upserts.cues![0]!.id;
      const macroId = repo.createMacro({
        name: 'Macro',
        description: '',
        cues: [{ cueId, orderIndex: 0, delayBeforeMs: 0, delayAfterMs: 0 }],
      }).upserts.macros![0]!.id;
      repo.createTriggerBinding({
        triggerType: 'slide.take',
        sourceId: 'KeyM',
        targetType: 'macro',
        targetId: macroId,
        config: {},
      });

      const restore = failOnPrepare(repo, "DELETE FROM trigger_bindings WHERE target_type = 'macro' AND target_id = ?");
      try {
        expect(() => repo.deleteMacro(macroId)).toThrow(/forced failure/);
      } finally {
        restore();
      }

      const snapshot = repo.getSnapshot();
      expect(snapshot.macros.some((macro) => macro.id === macroId)).toBe(true);
      expect(snapshot.triggerBindings.some((binding) => binding.targetType === 'macro' && binding.targetId === macroId)).toBe(true);
    } finally {
      close();
      cleanup();
    }
  });

  it('deletes and renormalizes macros inside one outer transaction without nested-transaction errors', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const alphaId = repo.createMacro({ name: 'Alpha', description: '', cues: [] }).upserts.macros![0]!.id;
      const betaId = repo.createMacro({ name: 'Beta', description: '', cues: [] }).upserts.macros![0]!.id;
      const gammaId = repo.createMacro({ name: 'Gamma', description: '', cues: [] }).upserts.macros![0]!.id;

      expect(() => repo.deleteMacro(betaId)).not.toThrow();

      const macros = repo.getSnapshot().macros;
      expect(macros.some((macro) => macro.id === betaId)).toBe(false);
      expect(macros.find((macro) => macro.id === alphaId)?.order).toBe(0);
      expect(macros.find((macro) => macro.id === gammaId)?.order).toBe(1);
    } finally {
      close();
      cleanup();
    }
  });

  it('loads container themes, overlays, and stages without per-container slide reads during snapshot assembly', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      repo.createTheme({ name: 'Presentation Theme', themeType: 'presentation', width: 1920, height: 1080, elements: [makeThemeElement('pt-1', 'P', 1)] });
      repo.createTheme({ name: 'Lyric Theme', themeType: 'lyric', width: 1920, height: 1080, elements: [makeThemeElement('lt-1', 'L', 1)] });
      repo.createOverlay({ name: 'Overlay', elements: [makeThemeElement('ov-1', 'O', 1)] });
      repo.createStage({ name: 'Stage', width: 1920, height: 1080, elements: [makeThemeElement('st-1', 'S', 1)] });

      const tracker = collectSqlExecutions(repo);
      repo.getSnapshot();
      tracker.restore();

      expect(tracker.executions.get('SELECT background_json FROM slides WHERE id = ?') ?? 0).toBe(0);
      expect(
        tracker.executions.get(
          `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at
         FROM slide_elements
         WHERE slide_id = ?
         ORDER BY layer ASC, z_index ASC, created_at ASC`
        ) ?? 0
      ).toBe(0);
      expect(tracker.getTotalExecutions()).toBeLessThanOrEqual(30);
      expect(tracker.getReadExecutions()).toBeLessThanOrEqual(30);
    } finally {
      close();
      cleanup();
    }
  });

  it('duplicates multi-slide items without one slide-elements query per source slide', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const presentationTheme = repo.createTheme({
        name: 'Presentation Theme',
        themeType: 'presentation',
        width: 1920,
        height: 1080,
        elements: [makeThemeElement('theme-el-1', 'Theme', 1)],
      }).upserts.presentationThemes![0]!;
      const itemId = repo.createItem({ type: 'presentation', title: 'Deck', themeId: presentationTheme.id }).itemId;
      const firstSlide = repo.getSnapshot().slides.find((slide) => slide.presentationId === itemId)!;
      repo.duplicateSlide(firstSlide.id);
      repo.duplicateSlide(firstSlide.id);

      const tracker = collectSqlExecutions(repo);
      repo.duplicateItem({ type: 'presentation', id: itemId });
      tracker.restore();

      expect(
        tracker.executions.get(
          `SELECT type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id
           FROM slide_elements WHERE slide_id = ? ORDER BY z_index ASC, created_at ASC`
        ) ?? 0
      ).toBe(0);
      expect(tracker.getTotalExecutions()).toBeLessThanOrEqual(18);
      expect(tracker.getReadExecutions()).toBeLessThanOrEqual(8);
    } finally {
      close();
      cleanup();
    }
  });

  it('applies themes to multi-slide items without re-reading each slide separately', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const themeId = repo.createTheme({
        name: 'Presentation Theme',
        themeType: 'presentation',
        width: 1920,
        height: 1080,
        elements: [makeThemeElement('theme-el-1', 'Theme', 1)],
      }).upserts.presentationThemes![0]!.id;
      const itemId = repo.createItem({ type: 'presentation', title: 'Deck' }).itemId;
      const firstSlide = repo.getSnapshot().slides.find((slide) => slide.presentationId === itemId)!;
      repo.duplicateSlide(firstSlide.id);
      repo.duplicateSlide(firstSlide.id);

      const tracker = collectSqlExecutions(repo);
      repo.applyThemeToItem(themeId, { type: 'presentation', id: itemId });
      tracker.restore();

      expect(countSqlExecutionsMatching(
        tracker.executions,
        /FROM slide_elements WHERE slide_id = \? ORDER BY layer ASC/,
      )).toBe(1); // The theme's own container slide is read once.
      expect(countSqlExecutionsMatching(
        tracker.executions,
        /FROM slide_elements WHERE slide_id IN \(\?,\?,\?\) ORDER BY slide_id ASC/,
      )).toBe(1);
      expect(
        tracker.executions.get(
          `UPDATE slides
           SET background_json = ?, background_source = ?, updated_at = ?
           WHERE id IN (?,?,?)`
        ) ?? 0
      ).toBe(1);
      expect(tracker.executions.get('DELETE FROM slide_elements WHERE slide_id IN (?,?,?)') ?? 0).toBe(1);
      // Six writes are expected for three output rows: one item update, one
      // batched slide update, one batched delete, and three element inserts.
      expect(tracker.getWriteExecutions()).toBeLessThanOrEqual(6);
      expect(tracker.getTotalExecutions()).toBeLessThanOrEqual(16);
      expect(tracker.getReadExecutions()).toBeLessThanOrEqual(10);
    } finally {
      close();
      cleanup();
    }
  });

  it('syncs linked theme items without one slide update or delete per linked slide', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const themeId = repo.createTheme({
        name: 'Presentation Theme',
        themeType: 'presentation',
        width: 1920,
        height: 1080,
        elements: [makeThemeElement('theme-el-1', 'Theme', 1)],
      }).upserts.presentationThemes![0]!.id;
      const firstItemId = repo.createItem({ type: 'presentation', title: 'Deck A', themeId }).itemId;
      const secondItemId = repo.createItem({ type: 'presentation', title: 'Deck B', themeId }).itemId;
      const firstItemSlide = repo.getSnapshot().slides.find((slide) => slide.presentationId === firstItemId)!;
      const secondItemSlide = repo.getSnapshot().slides.find((slide) => slide.presentationId === secondItemId)!;
      repo.duplicateSlide(firstItemSlide.id);
      repo.duplicateSlide(firstItemSlide.id);
      repo.duplicateSlide(secondItemSlide.id);
      repo.duplicateSlide(secondItemSlide.id);

      const tracker = collectSqlExecutions(repo);
      repo.syncThemeToLinkedItems(themeId, 'presentation');
      tracker.restore();

      expect(
        tracker.executions.get(
          `UPDATE slides
           SET background_json = ?, background_source = ?, updated_at = ?
           WHERE id IN (?,?,?,?,?,?)`
        ) ?? 0
      ).toBe(1);
      expect(tracker.executions.get('DELETE FROM slide_elements WHERE slide_id IN (?,?,?,?,?,?)') ?? 0).toBe(1);
      expect(tracker.getTotalExecutions()).toBeLessThanOrEqual(20);
      expect(tracker.getReadExecutions()).toBeLessThanOrEqual(10);
    } finally {
      close();
      cleanup();
    }
  });

  it('exports bundles without one item-elements query per slide', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const itemId = repo.createItem({ type: 'presentation', title: 'Deck' }).itemId;
      const firstSlide = repo.getSnapshot().slides.find((slide) => slide.presentationId === itemId)!;
      repo.duplicateSlide(firstSlide.id);
      repo.duplicateSlide(firstSlide.id);

      const tracker = collectSqlExecutions(repo);
      const bundle = repo.exportBundle([itemId]);
      tracker.restore();

      expect(bundle.items).toHaveLength(1);
      expect(
        tracker.executions.get(
          `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at
         FROM slide_elements
         WHERE slide_id = ?
         ORDER BY layer ASC, z_index ASC, created_at ASC`
        ) ?? 0
      ).toBe(0);
      expect(tracker.getTotalExecutions()).toBeLessThanOrEqual(6);
      expect(tracker.getReadExecutions()).toBeLessThanOrEqual(6);
    } finally {
      close();
      cleanup();
    }
  });

  it('loads direct-id patch readers beyond SQLite variable limits by chunking ids', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const cueIds: Id[] = [];
      const macroIds: Id[] = [];
      const triggerBindingIds: Id[] = [];

      for (let index = 0; index < SQLITE_VARIABLE_LIMIT_BOUNDARY; index += 1) {
        const cueId = repo.createCue({ kind: 'overlay.clearAll', payload: {} }).upserts.cues![0]!.id;
        cueIds.push(cueId);

        const macroId = repo.createMacro({ name: `Macro ${index}`, description: '', cues: [] }).upserts.macros![0]!.id;
        macroIds.push(macroId);

        const triggerBindingId = repo.createTriggerBinding({
          triggerType: 'slide.take',
          sourceId: `Key-${index}`,
          targetType: 'macro',
          targetId: macroId,
          config: {},
        }).upserts.triggerBindings![0]!.id;
        triggerBindingIds.push(triggerBindingId);
      }

      const buildPatch = (repo as unknown as {
        buildPatch(spec: {
          upsertCueIds?: Id[];
          upsertMacroIds?: Id[];
          upsertTriggerBindingIds?: Id[];
        }): {
          upserts: {
            cues?: Array<{ id: Id }>;
            macros?: Array<{ id: Id }>;
            triggerBindings?: Array<{ id: Id }>;
          };
        };
      }).buildPatch.bind(repo);

      const patch = buildPatch({
        upsertCueIds: cueIds,
        upsertMacroIds: macroIds,
        upsertTriggerBindingIds: triggerBindingIds,
      });

      expect(patch.upserts.cues).toHaveLength(SQLITE_VARIABLE_LIMIT_BOUNDARY);
      expect(patch.upserts.macros).toHaveLength(SQLITE_VARIABLE_LIMIT_BOUNDARY);
      expect(patch.upserts.triggerBindings).toHaveLength(SQLITE_VARIABLE_LIMIT_BOUNDARY);
    } finally {
      close();
      cleanup();
    }
  });

  it('loads slide/background/element/source/owner readers beyond SQLite variable limits by chunking ids', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const ownerIds: Id[] = [];
      for (let index = 0; index < SQLITE_VARIABLE_LIMIT_BOUNDARY; index += 1) {
        ownerIds.push(repo.createItem({ type: 'presentation', title: `Deck ${index}` }).itemId);
      }

      const slides = repo.getSnapshot().slides
        .filter((slide) => slide.presentationId && ownerIds.includes(slide.presentationId))
        .sort((left, right) => left.id.localeCompare(right.id));
      const slideIds = slides.map((slide) => slide.id);

      const storeInternals = repo as unknown as {
        getSlideBackgroundsBySlideIds(slideIds: readonly Id[], operation: string): Map<Id, unknown>;
        getSlideElementsBySlideIdsMap(slideIds: readonly Id[], operation: string): Map<Id, unknown[]>;
        getSourceElementRowsBySlideIds(slideIds: readonly string[]): Map<string, unknown[]>;
        getSlideRowsByOwnerIds(ownerColumn: 'presentation_id', ownerIds: readonly Id[]): Map<Id, Array<{ id: string }>>;
        getSlideElementIdsBySlideIds(slideIds: Id[]): Id[];
        getSlidesByIds(ids: Id[]): Array<{ id: Id }>;
        getSlideElementsByIds(ids: Id[]): Array<{ id: Id }>;
      };

      const backgroundsBySlideId = storeInternals.getSlideBackgroundsBySlideIds(slideIds, 'issue-240-boundary');
      const elementsBySlideId = storeInternals.getSlideElementsBySlideIdsMap(slideIds, 'issue-240-boundary');
      const sourceRowsBySlideId = storeInternals.getSourceElementRowsBySlideIds(slideIds);
      const slidesByOwnerId = storeInternals.getSlideRowsByOwnerIds('presentation_id', ownerIds);
      const slideElementIds = storeInternals.getSlideElementIdsBySlideIds(slideIds);
      const hydratedSlides = storeInternals.getSlidesByIds(slideIds);
      const hydratedElements = storeInternals.getSlideElementsByIds(slideElementIds);

      expect(backgroundsBySlideId.size).toBe(SQLITE_VARIABLE_LIMIT_BOUNDARY);
      expect(elementsBySlideId.size).toBe(SQLITE_VARIABLE_LIMIT_BOUNDARY);
      expect(sourceRowsBySlideId.size).toBe(SQLITE_VARIABLE_LIMIT_BOUNDARY);
      expect(slidesByOwnerId.size).toBe(SQLITE_VARIABLE_LIMIT_BOUNDARY);
      expect(hydratedSlides).toHaveLength(SQLITE_VARIABLE_LIMIT_BOUNDARY);
      expect(hydratedElements).toHaveLength(slideElementIds.length);
      expect(slideElementIds.length).toBeGreaterThanOrEqual(SQLITE_VARIABLE_LIMIT_BOUNDARY);
    } finally {
      close();
      cleanup();
    }
  });

  it('loads talk script block readers beyond SQLite variable limits by chunking ids', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const talkSlideIds: Id[] = [];
      const talkScriptBlockIds: Id[] = [];

      for (let index = 0; index < SQLITE_VARIABLE_LIMIT_BOUNDARY; index += 1) {
        const { patch } = repo.createItem({ type: 'talk', title: `Talk ${index}` });
        const slideId = patch.upserts.slides?.[0]?.id;
        if (!slideId) throw new Error(`Talk ${index} was created without a slide patch`);
        talkSlideIds.push(slideId);
        const blockPatch = repo.createTalkScriptBlock({ slideId, text: `Block ${index}` });
        talkScriptBlockIds.push(blockPatch.upserts.talkScriptBlocks![0]!.id);
      }

      const storeInternals = repo as unknown as {
        getTalkScriptBlocksBySlideIdsMap(slideIds: readonly Id[]): Map<Id, unknown[]>;
        getTalkScriptBlockIdsBySlideIds(slideIds: Id[]): Id[];
        buildPatch(spec: { upsertTalkScriptBlockIds?: Id[] }): {
          upserts: { talkScriptBlocks?: Array<{ id: Id }> };
        };
      };

      const tracker = collectSqlExecutions(repo);
      const blocksBySlideId = storeInternals.getTalkScriptBlocksBySlideIdsMap(talkSlideIds);
      const blockIds = storeInternals.getTalkScriptBlockIdsBySlideIds(talkSlideIds);
      const patch = storeInternals.buildPatch({ upsertTalkScriptBlockIds: talkScriptBlockIds });
      tracker.restore();

      expect(blocksBySlideId.size).toBe(SQLITE_VARIABLE_LIMIT_BOUNDARY);
      expect(blockIds).toHaveLength(SQLITE_VARIABLE_LIMIT_BOUNDARY);
      expect(patch.upserts.talkScriptBlocks).toHaveLength(SQLITE_VARIABLE_LIMIT_BOUNDARY);
      expect(countSqlExecutionsMatching(
        tracker.executions,
        /SELECT id, slide_id, text, order_index, created_at, updated_at FROM talk_script_blocks WHERE slide_id IN/,
      )).toBe(6);
      expect(countSqlExecutionsMatching(
        tracker.executions,
        /SELECT id FROM talk_script_blocks WHERE slide_id IN/,
      )).toBe(6);
      expect(countSqlExecutionsMatching(
        tracker.executions,
        /SELECT id, slide_id, text, order_index, created_at, updated_at FROM talk_script_blocks WHERE id IN/,
      )).toBe(6);
      expect(tracker.getReadExecutions()).toBe(18);
    } finally {
      close();
      cleanup();
    }
  });
});
