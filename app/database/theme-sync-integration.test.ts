import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppSnapshot, Id, SlideElement, TextElementPayload } from '@core/types';
import { CastRepository } from './store';

// Covers #144: Apply, Reset, Sync, Detach, and duplication (slide + deck item)
// must each carry provenance correctly and have observably distinct
// semantics through the real repository/SQLite path, not just the pure
// merge function unit-tested in app/core/theme-sync.test.ts. "Reset to
// Theme" in the renderer is the same repository call as "Apply" — both are
// the destructive rebuild described by the parent issue (#104) — so this
// suite exercises `applyThemeToDeckItem` for both roles.

let repo: CastRepository;
let tmpDir: string;

function closeRepo(): void {
  (repo as unknown as { db: { close(): void } }).db.close();
}

function rawDb(): { prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown } } {
  return (repo as unknown as {
    db: { prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown } };
  }).db;
}

function createTheme(kind: 'slides' | 'lyrics', name = 'Theme'): Id {
  const patch = repo.createTheme({ name, kind, width: 1920, height: 1080 });
  const theme = patch.upserts.themes?.[0];
  if (!theme) throw new Error('createTheme returned no theme');
  return theme.id;
}

function createDeckItemWithTheme(type: 'presentation' | 'lyric', title: string, themeId: Id): Id {
  repo.createDeckItemWithTheme({ type, title, themeId });
  const snapshot = repo.getSnapshot();
  const list = type === 'presentation' ? snapshot.presentations : snapshot.lyrics;
  const item = list.find((entry) => entry.title === title);
  if (!item) throw new Error(`expected a created ${type} named "${title}"`);
  return item.id;
}

function slideIdForItem(itemId: Id): Id {
  const snapshot = repo.getSnapshot();
  const slide = snapshot.slides.find((entry) => entry.presentationId === itemId || entry.lyricId === itemId);
  if (!slide) throw new Error(`expected a slide owned by item ${itemId}`);
  return slide.id;
}

function elementsForSlide(snapshot: AppSnapshot, slideId: Id): SlideElement[] {
  return snapshot.slideElements.filter((element) => element.slideId === slideId);
}

function themeElementId(themeId: Id): Id {
  const theme = repo.getSnapshot().themes.find((entry) => entry.id === themeId);
  if (!theme || theme.elements.length === 0) throw new Error(`expected theme ${themeId} to have an element`);
  return theme.elements[0].id;
}

describe('theme sync integration — Apply, Reset, Sync, Detach, and duplication', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-sync-integration-'));
    repo = new CastRepository({
      dbPath: path.join(tmpDir, 'lumacast.sqlite'),
      userDataPath: tmpDir,
      documentsPath: tmpDir,
    });
  });

  afterEach(() => {
    closeRepo();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Apply/Reset vs Sync are observably distinct', () => {
    it('Sync preserves a user-created element that Apply (Reset) discards', () => {
      const themeId = createTheme('slides', 'Slide Theme');
      const itemId = createDeckItemWithTheme('presentation', 'Deck', themeId);
      const slideId = slideIdForItem(itemId);

      expect(elementsForSlide(repo.getSnapshot(), slideId)).toHaveLength(1);

      repo.createElement({
        slideId,
        type: 'shape',
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        payload: { fillColor: '#FF0000', borderColor: '#000000', borderWidth: 1, borderRadius: 0 },
      });

      const withCustom = elementsForSlide(repo.getSnapshot(), slideId);
      expect(withCustom).toHaveLength(2);
      const customElementId = withCustom.find((element) => element.sourceThemeElementId == null)?.id;
      expect(customElementId).toBeTruthy();

      // Sync (non-destructive merge): the custom element survives untouched.
      repo.syncThemeToLinkedDeckItems(themeId);
      const afterSync = elementsForSlide(repo.getSnapshot(), slideId);
      expect(afterSync).toHaveLength(2);
      expect(afterSync.some((element) => element.id === customElementId)).toBe(true);

      // Apply/Reset (destructive rebuild): the custom element is gone and
      // every remaining element is theme-owned.
      repo.applyThemeToDeckItem(themeId, itemId);
      const afterReset = elementsForSlide(repo.getSnapshot(), slideId);
      expect(afterReset).toHaveLength(1);
      expect(afterReset.some((element) => element.id === customElementId)).toBe(false);
      expect(afterReset.every((element) => element.sourceThemeElementId)).toBe(true);
    });

    it('Sync updates a matched theme-owned element in place, preserving its materialized id', () => {
      const themeId = createTheme('slides', 'Slide Theme');
      const itemId = createDeckItemWithTheme('presentation', 'Deck', themeId);
      const slideId = slideIdForItem(itemId);
      const originalElementId = elementsForSlide(repo.getSnapshot(), slideId)[0].id;
      const sourceElementId = themeElementId(themeId);

      const theme = repo.getSnapshot().themes.find((entry) => entry.id === themeId)!;
      repo.updateTheme({ id: themeId, elements: [{ ...theme.elements[0], x: 999 }] });

      repo.syncThemeToLinkedDeckItems(themeId);
      const after = elementsForSlide(repo.getSnapshot(), slideId);
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(originalElementId);
      expect(after[0].x).toBe(999);
      expect(after[0].sourceThemeElementId).toBe(sourceElementId);
    });
  });

  describe('Detach preserves appearance and neutralizes provenance', () => {
    it('keeps every visual property but clears provenance and the theme link', () => {
      const themeId = createTheme('slides', 'Slide Theme');
      const itemId = createDeckItemWithTheme('presentation', 'Deck', themeId);
      const slideId = slideIdForItem(itemId);
      const before = elementsForSlide(repo.getSnapshot(), slideId)[0];

      repo.detachThemeFromDeckItem(itemId);

      const snapshot = repo.getSnapshot();
      const item = snapshot.presentations.find((entry) => entry.id === itemId);
      expect(item?.themeId).toBeNull();

      const slide = snapshot.slides.find((entry) => entry.id === slideId);
      expect(slide?.backgroundSource).toBe('local');

      const after = elementsForSlide(snapshot, slideId)[0];
      expect(after.id).toBe(before.id);
      expect(after.sourceThemeElementId).toBeNull();
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
      expect(after.payload).toEqual(before.payload);
    });

    it('prevents a later Sync of the former theme from touching the detached item', () => {
      const themeId = createTheme('slides', 'Slide Theme');
      const itemId = createDeckItemWithTheme('presentation', 'Deck', themeId);
      const slideId = slideIdForItem(itemId);
      const before = elementsForSlide(repo.getSnapshot(), slideId)[0];

      repo.detachThemeFromDeckItem(itemId);

      const theme = repo.getSnapshot().themes.find((entry) => entry.id === themeId)!;
      repo.updateTheme({ id: themeId, elements: [{ ...theme.elements[0], x: 555 }] });
      repo.syncThemeToLinkedDeckItems(themeId);

      const after = elementsForSlide(repo.getSnapshot(), slideId)[0];
      expect(after.x).toBe(before.x);
      expect(after.x).not.toBe(555);
    });
  });

  describe('Duplication preserves provenance without sharing mutable ids', () => {
    it('duplicateDeckItem: the copy stays independently syncable', () => {
      const themeId = createTheme('slides', 'Slide Theme');
      const itemId = createDeckItemWithTheme('presentation', 'Original', themeId);
      const slideId = slideIdForItem(itemId);
      const originalElementId = elementsForSlide(repo.getSnapshot(), slideId)[0].id;
      const sourceElementId = themeElementId(themeId);

      const { itemId: duplicateItemId } = repo.duplicateDeckItem(itemId);
      const duplicateSlideId = slideIdForItem(duplicateItemId);
      const duplicateElement = elementsForSlide(repo.getSnapshot(), duplicateSlideId)[0];

      expect(duplicateItemId).not.toBe(itemId);
      expect(duplicateSlideId).not.toBe(slideId);
      expect(duplicateElement.id).not.toBe(originalElementId);
      expect(duplicateElement.sourceThemeElementId).toBe(sourceElementId);

      const duplicateOwnerTheme = repo.getSnapshot().presentations.find((entry) => entry.id === duplicateItemId)?.themeId;
      expect(duplicateOwnerTheme).toBe(themeId);

      // Mutate the theme and sync: both copies update independently, each
      // keeping its own materialized element id.
      const theme = repo.getSnapshot().themes.find((entry) => entry.id === themeId)!;
      repo.updateTheme({ id: themeId, elements: [{ ...theme.elements[0], x: 777 }] });
      repo.syncThemeToLinkedDeckItems(themeId);

      const originalAfter = elementsForSlide(repo.getSnapshot(), slideId)[0];
      const duplicateAfter = elementsForSlide(repo.getSnapshot(), duplicateSlideId)[0];
      expect(originalAfter.id).toBe(originalElementId);
      expect(originalAfter.x).toBe(777);
      expect(duplicateAfter.id).toBe(duplicateElement.id);
      expect(duplicateAfter.x).toBe(777);
      expect(duplicateAfter.id).not.toBe(originalAfter.id);
    });

    it('duplicateSlide: the sibling slide stays independently syncable within the same deck item', () => {
      const themeId = createTheme('slides', 'Slide Theme');
      const itemId = createDeckItemWithTheme('presentation', 'Deck', themeId);
      const slideId = slideIdForItem(itemId);
      const originalElementId = elementsForSlide(repo.getSnapshot(), slideId)[0].id;
      const sourceElementId = themeElementId(themeId);

      repo.duplicateSlide(slideId);
      const snapshotAfterDuplicate = repo.getSnapshot();
      const slidesForItem = snapshotAfterDuplicate.slides.filter((entry) => entry.presentationId === itemId);
      expect(slidesForItem).toHaveLength(2);
      const duplicateSlideId = slidesForItem.find((entry) => entry.id !== slideId)!.id;
      const duplicateElement = elementsForSlide(snapshotAfterDuplicate, duplicateSlideId)[0];

      expect(duplicateElement.id).not.toBe(originalElementId);
      expect(duplicateElement.sourceThemeElementId).toBe(sourceElementId);

      const theme = repo.getSnapshot().themes.find((entry) => entry.id === themeId)!;
      repo.updateTheme({ id: themeId, elements: [{ ...theme.elements[0], x: 321 }] });
      repo.syncThemeToLinkedDeckItems(themeId);

      const originalAfter = elementsForSlide(repo.getSnapshot(), slideId)[0];
      const duplicateAfter = elementsForSlide(repo.getSnapshot(), duplicateSlideId)[0];
      expect(originalAfter.x).toBe(321);
      expect(duplicateAfter.x).toBe(321);
      expect(originalAfter.id).not.toBe(duplicateAfter.id);
    });
  });

  describe('Sync distinguishes a failed lookup from a genuine no-op (#212)', () => {
    it('throws the same explicit error as Apply when the theme id does not resolve', () => {
      const themeId = createTheme('slides', 'Slide Theme');
      const itemId = createDeckItemWithTheme('presentation', 'Deck', themeId);
      const unresolvableId = 'does-not-exist';

      expect(() => repo.syncThemeToLinkedDeckItems(unresolvableId))
        .toThrow(`Theme not found: ${unresolvableId}`);
      expect(() => repo.applyThemeToDeckItem(unresolvableId, itemId))
        .toThrow(`Theme not found: ${unresolvableId}`);
    });

    it('returns an empty, no-op patch without throwing when the theme resolves but has no linked deck items', () => {
      const themeId = createTheme('slides', 'Unlinked Theme');

      let patch: ReturnType<typeof repo.syncThemeToLinkedDeckItems> | undefined;
      expect(() => {
        patch = repo.syncThemeToLinkedDeckItems(themeId);
      }).not.toThrow();

      expect(patch).toBeDefined();
      expect(patch!.upserts.presentations ?? []).toHaveLength(0);
      expect(patch!.upserts.lyrics ?? []).toHaveLength(0);
      expect(patch!.upserts.talks ?? []).toHaveLength(0);
      expect(patch!.upserts.slides ?? []).toHaveLength(0);
      expect(patch!.upserts.slideElements ?? []).toHaveLength(0);
      expect(patch!.deletes.slideElements ?? []).toHaveLength(0);
    });
  });

  describe('Multi-owner Sync is one transaction and fails all-or-nothing', () => {
    it('leaves every owner unchanged and reports the error when one owner is corrupt', () => {
      const themeId = createTheme('slides', 'Slide Theme');
      const goodItemId = createDeckItemWithTheme('presentation', 'Good', themeId);
      const badItemId = createDeckItemWithTheme('presentation', 'Bad', themeId);
      const goodSlideId = slideIdForItem(goodItemId);
      const badSlideId = slideIdForItem(badItemId);

      // Read the "good" owner's row and the theme's update ingredients via raw
      // SQL / the pre-corruption snapshot — `getSnapshot()` decodes every
      // persisted slide element up front, so it cannot be called again once
      // the "bad" owner's row is corrupted below.
      const goodElementRowBefore = rawDb()
        .prepare('SELECT id, x FROM slide_elements WHERE slide_id = ?')
        .get(goodSlideId) as { id: string; x: number };
      const badElementRow = rawDb()
        .prepare('SELECT id, payload_json FROM slide_elements WHERE slide_id = ?')
        .get(badSlideId) as { id: string; payload_json: string };
      const theme = repo.getSnapshot().themes.find((entry) => entry.id === themeId)!;

      // Corrupt the "bad" owner's persisted element payload directly, bypassing
      // the repository's own write path — simulating a corrupt/incompatible
      // record the sync must not silently skip (per #104's non-goals).
      rawDb().prepare('UPDATE slide_elements SET payload_json = ? WHERE id = ?').run('not valid json', badElementRow.id);

      repo.updateTheme({ id: themeId, elements: [{ ...theme.elements[0], x: 42 }] });

      expect(() => repo.syncThemeToLinkedDeckItems(themeId)).toThrow();

      // The good owner must be untouched — the multi-owner sync is one
      // transaction, so a failure on the bad owner rolls back the good one too.
      const goodElementRowAfter = rawDb()
        .prepare('SELECT id, x FROM slide_elements WHERE slide_id = ?')
        .get(goodSlideId) as { id: string; x: number };
      expect(goodElementRowAfter.id).toBe(goodElementRowBefore.id);
      expect(goodElementRowAfter.x).toBe(goodElementRowBefore.x);
      expect(goodElementRowAfter.x).not.toBe(42);

      // The bad owner's corrupt row is untouched too — no partial write leaked.
      const badElementAfter = rawDb()
        .prepare('SELECT payload_json FROM slide_elements WHERE id = ?')
        .get(badElementRow.id) as { payload_json: string };
      expect(badElementAfter.payload_json).toBe('not valid json');
    });

    it('reports the existing operation error rather than a generic failure', () => {
      const themeId = createTheme('slides', 'Slide Theme');
      const itemId = createDeckItemWithTheme('presentation', 'Deck', themeId);
      const slideId = slideIdForItem(itemId);
      const elementRow = rawDb()
        .prepare('SELECT id FROM slide_elements WHERE slide_id = ?')
        .get(slideId) as { id: string };
      rawDb().prepare('UPDATE slide_elements SET payload_json = ? WHERE id = ?').run('{broken', elementRow.id);

      let caught: unknown = null;
      try {
        repo.syncThemeToLinkedDeckItems(themeId);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/json|payload/i);
    });
  });

  describe('Sync keeps authored text attached to its originating field when theme fields reorder', () => {
    // Two-text-field theme, reordered after content is authored. Sync must
    // keep each authored text value attached to the field it came from (by
    // sourceThemeElementId), per #104's core motivation. Apply/Reset is a
    // documented non-goal here: it is a destructive rebuild that carries
    // over existing text purely by z-order position (app/core/themes.ts
    // `applyThemeToElements`, deliberately unchanged by #143), so a reorder
    // is expected to cross-attach text to the wrong field on Reset.

    function textPayload(text: string): TextElementPayload {
      return {
        text,
        fontFamily: 'Helvetica',
        fontSize: 48,
        color: '#FFFFFF',
        alignment: 'center',
        weight: '700',
      };
    }

    function makeTwoFieldTheme(): { themeId: Id; titleSourceId: Id; subtitleSourceId: Id } {
      const now = new Date().toISOString();
      const patch = repo.createTheme({
        name: 'Two Field Theme',
        kind: 'slides',
        width: 1920,
        height: 1080,
        elements: [
          {
            id: 'placeholder-title', slideId: '', type: 'text',
            x: 0, y: 0, width: 100, height: 20, rotation: 0, opacity: 1, zIndex: 10, layer: 'content',
            payload: textPayload('Title Default'),
            createdAt: now, updatedAt: now,
          },
          {
            id: 'placeholder-subtitle', slideId: '', type: 'text',
            x: 0, y: 100, width: 100, height: 20, rotation: 0, opacity: 1, zIndex: 20, layer: 'content',
            payload: textPayload('Subtitle Default'),
            createdAt: now, updatedAt: now,
          },
        ],
      });
      const theme = patch.upserts.themes?.[0];
      if (!theme) throw new Error('createTheme returned no theme');
      const [titleEl, subtitleEl] = theme.elements;
      return { themeId: theme.id, titleSourceId: titleEl.id, subtitleSourceId: subtitleEl.id };
    }

    function authorText(slideId: Id, sourceThemeElementId: Id, text: string): void {
      const element = elementsForSlide(repo.getSnapshot(), slideId).find((el) => el.sourceThemeElementId === sourceThemeElementId);
      if (!element) throw new Error(`expected an element sourced from ${sourceThemeElementId}`);
      repo.updateElement({ id: element.id, payload: { ...(element.payload as TextElementPayload), text } });
    }

    function textFor(slideId: Id, sourceThemeElementId: Id): string {
      const element = elementsForSlide(repo.getSnapshot(), slideId).find((el) => el.sourceThemeElementId === sourceThemeElementId);
      if (!element) throw new Error(`expected an element sourced from ${sourceThemeElementId}`);
      return (element.payload as TextElementPayload).text;
    }

    function reorderThemeFields(themeId: Id, titleSourceId: Id, subtitleSourceId: Id): void {
      const theme = repo.getSnapshot().themes.find((entry) => entry.id === themeId)!;
      const titleEl = theme.elements.find((el) => el.id === titleSourceId)!;
      const subtitleEl = theme.elements.find((el) => el.id === subtitleSourceId)!;
      // Swap z-order: subtitle now reads first, title now reads last.
      repo.updateTheme({
        id: themeId,
        elements: [{ ...titleEl, zIndex: 30 }, { ...subtitleEl, zIndex: 5 }],
      });
    }

    it('Sync: authored text stays attached to its field after the theme fields reorder', () => {
      const { themeId, titleSourceId, subtitleSourceId } = makeTwoFieldTheme();
      const itemId = createDeckItemWithTheme('presentation', 'Deck', themeId);
      const slideId = slideIdForItem(itemId);

      authorText(slideId, titleSourceId, 'Title Text');
      authorText(slideId, subtitleSourceId, 'Subtitle Text');

      reorderThemeFields(themeId, titleSourceId, subtitleSourceId);
      repo.syncThemeToLinkedDeckItems(themeId);

      expect(textFor(slideId, titleSourceId)).toBe('Title Text');
      expect(textFor(slideId, subtitleSourceId)).toBe('Subtitle Text');
    });

    it('Reset: documented non-goal — positional carry-over cross-attaches text after reorder', () => {
      const { themeId, titleSourceId, subtitleSourceId } = makeTwoFieldTheme();
      const itemId = createDeckItemWithTheme('presentation', 'Deck', themeId);
      const slideId = slideIdForItem(itemId);

      authorText(slideId, titleSourceId, 'Title Text');
      authorText(slideId, subtitleSourceId, 'Subtitle Text');

      reorderThemeFields(themeId, titleSourceId, subtitleSourceId);
      repo.applyThemeToDeckItem(themeId, itemId);

      // Apply/Reset positionally shifts the pre-reset z-ordered text values
      // into the post-reorder theme element walk order, crossing the two
      // fields' content — the exact failure mode #104 introduced Sync to fix,
      // left in place for Apply per #143's non-goals.
      expect(textFor(slideId, subtitleSourceId)).toBe('Title Text');
      expect(textFor(slideId, titleSourceId)).toBe('Subtitle Text');
    });
  });
});
