import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Id } from '@lumacast/kernel';
import type { SlideBackground, SlideElement } from '@lumacast/composition';
import type { AppSnapshot } from '@lumacast/protocol';
import { CastRepository } from './store';

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

describe('CastRepository.applyThemeToDeckItem', () => {
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

  it('throws a descriptive error for a missing theme id', () => {
    const itemId = createDeckItem('presentation', 'Deck');
    expect(() => repo.applyThemeToDeckItem('no-such-theme', itemId)).toThrow(/Theme not found: no-such-theme/);
  });

  it('throws a descriptive error for a missing owner id', () => {
    const themeId = createTheme('slides');
    expect(() => repo.applyThemeToDeckItem(themeId, 'no-such-item')).toThrow(/Deck item not found: no-such-item/);
  });

  it('throws a descriptive error for an incompatible theme kind', () => {
    const themeId = createTheme('lyrics', 'Lyric Theme');
    const itemId = createDeckItem('presentation', 'Deck');
    expect(() => repo.applyThemeToDeckItem(themeId, itemId)).toThrow(/not compatible/);
  });

  it('applies a slides theme to a presentation and materializes its elements', () => {
    const themeId = createTheme('slides', 'Slide Theme');
    const itemId = createDeckItem('presentation', 'Deck');
    const slideId = repo.getSnapshot().slides.find((slide) => slide.presentationId === itemId)?.id;
    if (!slideId) throw new Error('expected a slide on the created presentation');

    const patch = repo.applyThemeToDeckItem(themeId, itemId);

    const presentation = patch.upserts.presentations?.[0];
    expect(presentation?.themeId).toBe(themeId);

    const snapshot = repo.getSnapshot();
    const slide = snapshot.slides.find((entry) => entry.id === slideId);
    expect(slide?.backgroundSource).toBe('theme');
    const elements = elementsForSlide(snapshot, slideId);
    expect(elements.length).toBeGreaterThan(0);
    expect(elements.every((element) => element.sourceThemeElementId)).toBe(true);
  });

  it('applies a slides theme to a talk', () => {
    const themeId = createTheme('slides', 'Slide Theme');
    const itemId = createDeckItem('talk', 'Talk');
    const patch = repo.applyThemeToDeckItem(themeId, itemId);
    expect(patch.upserts.talks?.[0]?.themeId).toBe(themeId);
  });

  it('applies a lyric theme to a lyric', () => {
    const themeId = createTheme('lyrics', 'Lyric Theme');
    const itemId = createDeckItem('lyric', 'Song');
    const patch = repo.applyThemeToDeckItem(themeId, itemId);
    expect(patch.upserts.lyrics?.[0]?.themeId).toBe(themeId);
  });

  it('detaching clears the relationship but keeps materialized slide content', () => {
    const themeId = createTheme('slides', 'Slide Theme');
    const itemId = createDeckItem('presentation', 'Deck');
    repo.applyThemeToDeckItem(themeId, itemId);
    const slideId = repo.getSnapshot().slides.find((slide) => slide.presentationId === itemId)?.id;
    if (!slideId) throw new Error('expected a slide on the created presentation');
    const materializedCount = elementsForSlide(repo.getSnapshot(), slideId).length;
    expect(materializedCount).toBeGreaterThan(0);

    const patch = repo.detachThemeFromDeckItem(itemId);

    expect(patch.upserts.presentations?.[0]?.themeId).toBeNull();
    const snapshot = repo.getSnapshot();
    const slide = snapshot.slides.find((entry) => entry.id === slideId);
    expect(slide?.backgroundSource).toBe('local');
    const remaining = elementsForSlide(snapshot, slideId);
    expect(remaining.length).toBe(materializedCount);
    expect(remaining.every((element) => element.sourceThemeElementId == null)).toBe(true);
  });

  it('sync refreshes theme-owned backgrounds but preserves a local override', () => {
    const themeId = createTheme('slides', 'Slide Theme');
    const themeBackground: SlideBackground = { type: 'color', color: '#AAAAAA' };
    repo.updateTheme({ id: themeId, background: themeBackground });

    const themedItemId = createDeckItem('presentation', 'Themed Deck');
    const localOverrideItemId = createDeckItem('presentation', 'Local Override Deck');
    repo.applyThemeToDeckItem(themeId, themedItemId);
    repo.applyThemeToDeckItem(themeId, localOverrideItemId);

    const snapshot = repo.getSnapshot();
    const localOverrideSlide = snapshot.slides.find((slide) => slide.presentationId === localOverrideItemId);
    const themedSlide = snapshot.slides.find((slide) => slide.presentationId === themedItemId);
    if (!localOverrideSlide || !themedSlide) throw new Error('expected slides on both presentations');
    repo.updateSlideBackground({
      slideId: localOverrideSlide.id,
      background: { type: 'color', color: '#B0B0B0' },
    });

    const replacedBackground: SlideBackground = { type: 'color', color: '#CCCCCC' };
    repo.updateTheme({ id: themeId, background: replacedBackground });
    repo.syncThemeToLinkedDeckItems(themeId);

    const after = repo.getSnapshot();
    const localOverrideAfter = after.slides.find((slide) => slide.id === localOverrideSlide.id);
    const themedAfter = after.slides.find((slide) => slide.id === themedSlide.id);
    expect(localOverrideAfter?.backgroundSource).toBe('local');
    expect(localOverrideAfter?.background).toEqual({ type: 'color', color: '#B0B0B0' });
    expect(themedAfter?.backgroundSource).toBe('theme');
    expect(themedAfter?.background).toEqual(replacedBackground);
  });
});
