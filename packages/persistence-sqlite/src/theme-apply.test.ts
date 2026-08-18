import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Id } from '@lumacast/kernel';
import type { ItemType, SlideBackground, SlideElement, ThemeOwnerType } from '@lumacast/composition';
import type { AppSnapshot } from '@lumacast/protocol';
import { CastRepository } from './store';

let repo: CastRepository;
let tmpDir: string;

function closeRepo(): void {
  (repo as unknown as { db: { close(): void } }).db.close();
}

// #219 item-model refactor: one per-owner theme table per family — the wire
// patch key that carries a given family's rows also varies by family.
type ThemePatchKey = 'presentationThemes' | 'lyricThemes' | 'talkThemes' | 'overlayThemes';
const THEME_PATCH_KEY: Record<ThemeOwnerType, ThemePatchKey> = {
  presentation: 'presentationThemes',
  lyric: 'lyricThemes',
  talk: 'talkThemes',
  overlay: 'overlayThemes',
};

function createTheme(themeType: ThemeOwnerType, name = 'Theme'): Id {
  const patch = repo.createTheme({ name, themeType, width: 1920, height: 1080 });
  const theme = patch.upserts[THEME_PATCH_KEY[themeType]]?.[0];
  if (!theme) throw new Error('createTheme returned no theme');
  return theme.id;
}

function createItem(type: ItemType, title: string): Id {
  return repo.createItem({ type, title }).itemId;
}

function elementsForSlide(snapshot: AppSnapshot, slideId: Id): SlideElement[] {
  return snapshot.slideElements.filter((element) => element.slideId === slideId);
}

function slideIdForItem(type: ItemType, itemId: Id): Id {
  const snapshot = repo.getSnapshot();
  const slide = snapshot.slides.find((entry) =>
    type === 'presentation' ? entry.presentationId === itemId
    : type === 'lyric' ? entry.lyricId === itemId
    : entry.talkId === itemId
  );
  if (!slide) throw new Error(`expected a slide owned by ${type} ${itemId}`);
  return slide.id;
}

describe('CastRepository.applyThemeToItem', () => {
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
    const itemId = createItem('presentation', 'Deck');
    expect(() => repo.applyThemeToItem('no-such-theme', { type: 'presentation', id: itemId })).toThrow(/Theme not found: no-such-theme/);
  });

  it('throws a descriptive error for a missing owner id', () => {
    const themeId = createTheme('presentation');
    expect(() => repo.applyThemeToItem(themeId, { type: 'presentation', id: 'no-such-item' })).toThrow(/Item not found: no-such-item/);
  });

  it('throws for a theme id from a different family — the four theme tables are independent id spaces, so a lyric theme can never be found when applying to a presentation', () => {
    const lyricThemeId = createTheme('lyric', 'Lyric Theme');
    const itemId = createItem('presentation', 'Deck');
    expect(() => repo.applyThemeToItem(lyricThemeId, { type: 'presentation', id: itemId })).toThrow(new RegExp(`Theme not found: ${lyricThemeId}`));
  });

  it('applies a presentation theme to a presentation and materializes its elements', () => {
    const themeId = createTheme('presentation', 'Slide Theme');
    const itemId = createItem('presentation', 'Deck');
    const slideId = slideIdForItem('presentation', itemId);

    const patch = repo.applyThemeToItem(themeId, { type: 'presentation', id: itemId });

    const presentation = patch.upserts.presentations?.[0];
    expect(presentation?.themeId).toBe(themeId);

    const snapshot = repo.getSnapshot();
    const slide = snapshot.slides.find((entry) => entry.id === slideId);
    expect(slide?.backgroundSource).toBe('theme');
    const elements = elementsForSlide(snapshot, slideId);
    expect(elements.length).toBeGreaterThan(0);
    expect(elements.every((element) => element.sourceThemeElementId)).toBe(true);
  });

  it('applies a talk theme to a talk', () => {
    const themeId = createTheme('talk', 'Talk Theme');
    const itemId = createItem('talk', 'Talk');
    const patch = repo.applyThemeToItem(themeId, { type: 'talk', id: itemId });
    expect(patch.upserts.talks?.[0]?.themeId).toBe(themeId);
  });

  it('applies a lyric theme to a lyric', () => {
    const themeId = createTheme('lyric', 'Lyric Theme');
    const itemId = createItem('lyric', 'Song');
    const patch = repo.applyThemeToItem(themeId, { type: 'lyric', id: itemId });
    expect(patch.upserts.lyrics?.[0]?.themeId).toBe(themeId);
  });

  it('detaching clears the relationship but keeps materialized slide content', () => {
    const themeId = createTheme('presentation', 'Slide Theme');
    const itemId = createItem('presentation', 'Deck');
    repo.applyThemeToItem(themeId, { type: 'presentation', id: itemId });
    const slideId = slideIdForItem('presentation', itemId);
    const materializedCount = elementsForSlide(repo.getSnapshot(), slideId).length;
    expect(materializedCount).toBeGreaterThan(0);

    const patch = repo.detachThemeFromItem({ type: 'presentation', id: itemId });

    expect(patch.upserts.presentations?.[0]?.themeId).toBeNull();
    const snapshot = repo.getSnapshot();
    const slide = snapshot.slides.find((entry) => entry.id === slideId);
    expect(slide?.backgroundSource).toBe('local');
    const remaining = elementsForSlide(snapshot, slideId);
    expect(remaining.length).toBe(materializedCount);
    expect(remaining.every((element) => element.sourceThemeElementId == null)).toBe(true);
  });

  it('sync refreshes theme-owned backgrounds but preserves a local override', () => {
    const themeId = createTheme('presentation', 'Slide Theme');
    const themeBackground: SlideBackground = { type: 'color', color: '#AAAAAA' };
    repo.updateTheme({ id: themeId, themeType: 'presentation', background: themeBackground });

    const themedItemId = createItem('presentation', 'Themed Deck');
    const localOverrideItemId = createItem('presentation', 'Local Override Deck');
    repo.applyThemeToItem(themeId, { type: 'presentation', id: themedItemId });
    repo.applyThemeToItem(themeId, { type: 'presentation', id: localOverrideItemId });

    const snapshot = repo.getSnapshot();
    const localOverrideSlide = snapshot.slides.find((slide) => slide.presentationId === localOverrideItemId);
    const themedSlide = snapshot.slides.find((slide) => slide.presentationId === themedItemId);
    if (!localOverrideSlide || !themedSlide) throw new Error('expected slides on both presentations');
    repo.updateSlideBackground({
      slideId: localOverrideSlide.id,
      background: { type: 'color', color: '#B0B0B0' },
    });

    const replacedBackground: SlideBackground = { type: 'color', color: '#CCCCCC' };
    repo.updateTheme({ id: themeId, themeType: 'presentation', background: replacedBackground });
    repo.syncThemeToLinkedItems(themeId, 'presentation');

    const after = repo.getSnapshot();
    const localOverrideAfter = after.slides.find((slide) => slide.id === localOverrideSlide.id);
    const themedAfter = after.slides.find((slide) => slide.id === themedSlide.id);
    expect(localOverrideAfter?.backgroundSource).toBe('local');
    expect(localOverrideAfter?.background).toEqual({ type: 'color', color: '#B0B0B0' });
    expect(themedAfter?.backgroundSource).toBe('theme');
    expect(themedAfter?.background).toEqual(replacedBackground);
  });
});
