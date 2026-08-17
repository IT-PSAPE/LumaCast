import { describe, expect, it } from 'vitest';
import { isThemeCompatibleWithDeckItem, isThemeCompatibleWithOwnerKind } from './themes';
import type { DeckItemType, Theme, ThemeKind, ThemeOwnerKind } from './types';

const T0 = '2024-01-01T00:00:00.000Z';

function themeOfKind(kind: ThemeKind): Theme {
  return {
    id: `theme-${kind}`,
    slideId: `theme-${kind}-slide`,
    name: `${kind} theme`,
    kind,
    width: 1920,
    height: 1080,
    elements: [],
    collectionId: 'collection-1',
    order: 0,
    createdAt: T0,
    updatedAt: T0,
  };
}

const ALL_OWNER_KINDS: readonly ThemeOwnerKind[] = ['presentation', 'lyric', 'talk', 'overlay'];
const ALL_DECK_ITEM_TYPES: readonly DeckItemType[] = ['presentation', 'lyric', 'talk'];

describe('isThemeCompatibleWithOwnerKind (capability matrix)', () => {
  it('slide themes are compatible with presentation and talk owners only', () => {
    const theme = themeOfKind('slides');
    expect(isThemeCompatibleWithOwnerKind(theme, 'presentation')).toBe(true);
    expect(isThemeCompatibleWithOwnerKind(theme, 'talk')).toBe(true);
    expect(isThemeCompatibleWithOwnerKind(theme, 'lyric')).toBe(false);
    expect(isThemeCompatibleWithOwnerKind(theme, 'overlay')).toBe(false);
  });

  it('lyric themes are compatible with lyric owners only', () => {
    const theme = themeOfKind('lyrics');
    expect(isThemeCompatibleWithOwnerKind(theme, 'lyric')).toBe(true);
    expect(isThemeCompatibleWithOwnerKind(theme, 'presentation')).toBe(false);
    expect(isThemeCompatibleWithOwnerKind(theme, 'talk')).toBe(false);
    expect(isThemeCompatibleWithOwnerKind(theme, 'overlay')).toBe(false);
  });

  it('overlay themes are compatible with overlay owners only', () => {
    const theme = themeOfKind('overlays');
    expect(isThemeCompatibleWithOwnerKind(theme, 'overlay')).toBe(true);
    expect(isThemeCompatibleWithOwnerKind(theme, 'presentation')).toBe(false);
    expect(isThemeCompatibleWithOwnerKind(theme, 'lyric')).toBe(false);
    expect(isThemeCompatibleWithOwnerKind(theme, 'talk')).toBe(false);
  });

  it('never reports more than the fixed matrix as compatible', () => {
    const matrix: Record<ThemeKind, ThemeOwnerKind[]> = {
      slides: ['presentation', 'talk'],
      lyrics: ['lyric'],
      overlays: ['overlay'],
    };
    for (const kind of Object.keys(matrix) as ThemeKind[]) {
      const theme = themeOfKind(kind);
      for (const ownerKind of ALL_OWNER_KINDS) {
        const expected = matrix[kind].includes(ownerKind);
        expect(isThemeCompatibleWithOwnerKind(theme, ownerKind)).toBe(expected);
      }
    }
  });
});

describe('isThemeCompatibleWithDeckItem (deck-item convenience wrapper)', () => {
  it('agrees with isThemeCompatibleWithOwnerKind for every theme kind and deck item type, including talk', () => {
    for (const kind of ['slides', 'lyrics', 'overlays'] as ThemeKind[]) {
      const theme = themeOfKind(kind);
      for (const deckItemType of ALL_DECK_ITEM_TYPES) {
        expect(isThemeCompatibleWithDeckItem(theme, deckItemType))
          .toBe(isThemeCompatibleWithOwnerKind(theme, deckItemType));
      }
    }
  });

  it('treats talk exactly like presentation for slide themes', () => {
    const theme = themeOfKind('slides');
    expect(isThemeCompatibleWithDeckItem(theme, 'talk')).toBe(true);
    expect(isThemeCompatibleWithDeckItem(theme, 'talk')).toBe(isThemeCompatibleWithDeckItem(theme, 'presentation'));
  });

  it('never reports a deck item compatible with an overlay theme', () => {
    const theme = themeOfKind('overlays');
    for (const deckItemType of ALL_DECK_ITEM_TYPES) {
      expect(isThemeCompatibleWithDeckItem(theme, deckItemType)).toBe(false);
    }
  });
});
