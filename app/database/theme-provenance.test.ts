import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import type { AppSnapshot } from '@lumacast/protocol';
import { CastRepository } from './store';

// Covers the bundle-import half of theme element provenance
// (`source_theme_element_id`): #142's fixed decision that provenance is
// preserved across bundle serialization even though imports materialize
// brand-new theme element ids. Exact-copy provenance (duplicate deck item,
// duplicate slide) is already covered by other suites; this file is scoped
// to `finalizeImportBundle`.

let repo: CastRepository;
let tmpDir: string;

function closeRepo(): void {
  (repo as unknown as { db: { close(): void } }).db.close();
}

function createTheme(kind: 'slides' | 'lyrics', name = 'Theme'): Id {
  const patch = repo.createTheme({ name, kind, width: 1920, height: 1080 });
  const theme = patch.upserts.themes?.[0];
  if (!theme) throw new Error('createTheme returned no theme');
  return theme.id;
}

function createDeckItem(type: 'presentation' | 'lyric' | 'talk', title: string): Id {
  const patch = repo.createDeckItemWithTheme({ type, title });
  const key = type === 'presentation' ? 'presentations' : type === 'lyric' ? 'lyrics' : 'talks';
  const item = patch.upserts[key]?.[0];
  if (!item) throw new Error(`createDeckItemWithTheme returned no ${key} item`);
  return item.id;
}

function elementsForSlide(snapshot: AppSnapshot, slideId: Id): SlideElement[] {
  return snapshot.slideElements.filter((element) => element.slideId === slideId);
}

function firstSlideIdForPresentation(snapshot: AppSnapshot, presentationId: Id): Id {
  const slide = snapshot.slides.find((entry) => entry.presentationId === presentationId);
  if (!slide) throw new Error(`expected a slide for presentation ${presentationId}`);
  return slide.id;
}

describe('CastRepository.finalizeImportBundle element provenance', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-test-'));
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

  it('threads sourceThemeElementId through export/import via the newly materialized theme element ids', () => {
    const themeId = createTheme('slides', 'Slide Theme');
    const itemId = createDeckItem('presentation', 'Deck');
    repo.applyThemeToDeckItem(themeId, itemId);

    const before = repo.getSnapshot();
    const slideId = firstSlideIdForPresentation(before, itemId);
    const originalTheme = before.themes.find((theme) => theme.id === themeId);
    if (!originalTheme) throw new Error('expected the created theme in the snapshot');
    const originalThemeElementIds = new Set(originalTheme.elements.map((element) => element.id));
    const originalSlideElements = elementsForSlide(before, slideId);

    expect(originalSlideElements.length).toBeGreaterThan(0);
    expect(originalSlideElements.every((element) => Boolean(element.sourceThemeElementId) && originalThemeElementIds.has(element.sourceThemeElementId as Id))).toBe(true);

    const manifest = repo.exportDeckBundle([itemId]);
    const after = repo.finalizeImportBundle(manifest, []);

    const importedItem = after.presentations.find((presentation) => presentation.id !== itemId && presentation.title === 'Deck');
    expect(importedItem).toBeTruthy();
    const importedTheme = after.themes.find((theme) => theme.id !== themeId && theme.name === 'Slide Theme');
    expect(importedTheme).toBeTruthy();
    expect(importedItem?.themeId).toBe(importedTheme?.id);

    const importedThemeElementIds = new Set((importedTheme?.elements ?? []).map((element) => element.id));
    // The imported theme is materialized with fresh ids, never reusing the
    // exporting database's ids.
    for (const id of importedThemeElementIds) {
      expect(originalThemeElementIds.has(id)).toBe(false);
    }

    const importedSlideId = firstSlideIdForPresentation(after, importedItem!.id);
    const importedSlideElements = elementsForSlide(after, importedSlideId);

    expect(importedSlideElements.length).toBe(originalSlideElements.length);
    for (const element of importedSlideElements) {
      // Provenance survived the round trip, translated onto the new theme's
      // materialized element ids - never the stale pre-import id, and never
      // dropped to null when a real mapping exists.
      expect(element.sourceThemeElementId).toBeTruthy();
      expect(importedThemeElementIds.has(element.sourceThemeElementId as Id)).toBe(true);
      expect(originalThemeElementIds.has(element.sourceThemeElementId as Id)).toBe(false);
    }
  });

  it('nulls a dangling sourceThemeElementId instead of writing an id absent from the imported theme', () => {
    const themeId = createTheme('slides', 'Slide Theme');
    const itemId = createDeckItem('presentation', 'Deck');
    repo.applyThemeToDeckItem(themeId, itemId);

    const manifest = repo.exportDeckBundle([itemId]);
    const targetSlide = manifest.items[0]?.slides[0];
    const targetElement = targetSlide?.elements.find((element) => element.sourceThemeElementId);
    if (!targetSlide || !targetElement) throw new Error('expected a themed element in the exported manifest');
    const originalElementCount = targetSlide.elements.length;

    // Simulate a manifest whose recorded provenance cannot be proven against
    // the bundle being imported (corrupted/edited bundle, or a theme that
    // was stripped before import).
    targetElement.sourceThemeElementId = 'ghost:theme:99';

    const after = repo.finalizeImportBundle(manifest, []);
    const importedItem = after.presentations.find((presentation) => presentation.id !== itemId && presentation.title === 'Deck');
    if (!importedItem) throw new Error('expected the imported presentation');
    const importedSlideId = firstSlideIdForPresentation(after, importedItem.id);
    const importedElements = elementsForSlide(after, importedSlideId);

    // The element itself survives the import (unproven provenance must
    // never be treated as "delete this element").
    expect(importedElements.length).toBe(originalElementCount);
    const mutatedElement = importedElements.find((element) => element.type === targetElement.type);
    expect(mutatedElement?.sourceThemeElementId ?? null).toBeNull();
  });

  it('nulls sourceThemeElementId that resolves to a real theme element belonging to a different theme than the one assigned to the item', () => {
    const themeAId = createTheme('slides', 'Theme A');
    const themeBId = createTheme('slides', 'Theme B');
    const itemAId = createDeckItem('presentation', 'Deck A');
    const itemBId = createDeckItem('presentation', 'Deck B');
    repo.applyThemeToDeckItem(themeAId, itemAId);
    repo.applyThemeToDeckItem(themeBId, itemBId);

    const themeB = repo.getSnapshot().themes.find((theme) => theme.id === themeBId);
    const themeBElementId = themeB?.elements[0]?.id;
    if (!themeBElementId) throw new Error('expected theme B to have a materialized element');

    const manifest = repo.exportDeckBundle([itemAId, itemBId]);
    expect(manifest.themes.map((theme) => theme.id).sort()).toEqual([themeAId, themeBId].sort());

    const itemAManifest = manifest.items.find((item) => item.id === itemAId);
    const elementA = itemAManifest?.slides[0]?.elements.find((element) => element.sourceThemeElementId);
    if (!itemAManifest || !elementA) throw new Error('expected a themed element for item A');

    // Corrupt: item A is themed with A, but this element claims provenance
    // from a (real, present-in-bundle) element of theme B.
    elementA.sourceThemeElementId = themeBElementId;

    const after = repo.finalizeImportBundle(manifest, []);
    const importedItemA = after.presentations.find((presentation) => presentation.id !== itemAId && presentation.title === 'Deck A');
    if (!importedItemA) throw new Error('expected the imported "Deck A" presentation');
    const importedSlideId = firstSlideIdForPresentation(after, importedItemA.id);
    const importedElements = elementsForSlide(after, importedSlideId);
    const correspondingElement = importedElements.find((element) => element.type === elementA.type);

    expect(correspondingElement?.sourceThemeElementId ?? null).toBeNull();
  });

  it('regression: an imported themed deck item survives a subsequent syncThemeToLinkedDeckItems without losing or duplicating elements', () => {
    const themeId = createTheme('slides', 'Slide Theme');
    const itemId = createDeckItem('presentation', 'Deck');
    repo.applyThemeToDeckItem(themeId, itemId);

    const manifest = repo.exportDeckBundle([itemId]);
    const imported = repo.finalizeImportBundle(manifest, []);

    const importedTheme = imported.themes.find((theme) => theme.id !== themeId && theme.name === 'Slide Theme');
    const importedItem = imported.presentations.find((presentation) => presentation.id !== itemId && presentation.title === 'Deck');
    if (!importedTheme || !importedItem) throw new Error('expected the imported theme and presentation');
    const importedSlideId = firstSlideIdForPresentation(imported, importedItem.id);
    const beforeSync = elementsForSlide(imported, importedSlideId);

    // Sanity: the imported deck item's elements are already 1:1 with the
    // imported theme's own elements (this is what a correct import produces).
    expect(beforeSync.length).toBe(importedTheme.elements.length);

    repo.syncThemeToLinkedDeckItems(importedTheme.id);

    const afterSync = repo.getSnapshot();
    const afterSyncElements = elementsForSlide(afterSync, importedSlideId);

    // With provenance correctly threaded, sync matches every element to its
    // theme source and updates in place - it must never fall back to
    // treating them as unmatched user content (which would leave them
    // untouched *and* add a duplicate materialized copy of every theme
    // element alongside them).
    expect(afterSyncElements.length).toBe(importedTheme.elements.length);
    expect(afterSyncElements.every((element) => Boolean(element.sourceThemeElementId))).toBe(true);
  });
});
