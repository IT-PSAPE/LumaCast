import { describe, expect, it } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { ItemType, ThemeOwnerType } from '@lumacast/composition';
import type { CastRepository } from './store';
import { createTestRepository } from './test-support';

// Covers the theme/overlay slice of #214: `updateTheme`,
// `detachThemeFromItem`, and `applyThemeToOverlay` each had a branch
// that silently returned an empty patch when an id failed to resolve, even
// though a sibling method in this file (`applyThemeToItem`,
// `syncThemeToLinkedItems`) already throws `Theme not found`/`Item not
// found` for the identical lookup failure. Group 1 (2bcdedf) converted
// the missing-theme branch of `applyThemeToOverlay`; group 2 converts its
// two remaining silent branches: an incompatible theme — a validity failure
// mirroring `applyThemeToItem`'s compatibility throw, not a missing
// lookup — and an unresolvable overlay. These tests pin the fixed contract
// for all three branches, and separately pin that the one genuine no-op
// this issue leaves alone (already-untethered theme) still returns an empty
// patch without throwing.
//
// #219 item-model refactor: the single `themes` table (discriminated by
// `kind`) split into four independent per-owner tables. What used to be an
// "incompatible theme kind" validity failure (both ids resolve, but the
// kinds don't match) is now, structurally, just another missing-theme
// lookup: a theme id from one family's table is never present in another
// family's table, since the four are separate id spaces. The invariant
// itself — a theme belonging to the wrong family can never be applied —
// still holds; only the shape of the failure (not-found vs. not-compatible)
// changed, so these tests are ported rather than deleted.

function createItem(repo: CastRepository, type: ItemType, title: string): Id {
  return repo.createItem({ type, title }).itemId;
}

function createTheme(repo: CastRepository, themeType: ThemeOwnerType, name = 'Theme'): Id {
  const patch = repo.createTheme({ name, themeType });
  const key = themeType === 'presentation' ? 'presentationThemes'
    : themeType === 'lyric' ? 'lyricThemes'
    : themeType === 'talk' ? 'talkThemes'
    : 'overlayThemes';
  const theme = patch.upserts[key]?.[0];
  if (!theme) throw new Error('createTheme returned no theme');
  return theme.id;
}

function createOverlay(repo: CastRepository, name = 'Overlay'): Id {
  const patch = repo.createOverlay({ name });
  const overlay = patch.upserts.overlays?.[0];
  if (!overlay) throw new Error('createOverlay returned no overlay');
  return overlay.id;
}

describe('CastRepository.updateTheme (#214)', () => {
  it('throws for an unresolvable theme id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.updateTheme({ id: 'no-such-theme', themeType: 'presentation', name: 'New name' }))
        .toThrow(/Theme not found: no-such-theme/);
    } finally {
      close();
      cleanup();
    }
  });

  it('updates an existing theme without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const themeId = createTheme(repo, 'presentation');
      const patch = repo.updateTheme({ id: themeId, themeType: 'presentation', name: 'Renamed' });
      expect(patch.upserts.presentationThemes?.[0]?.name).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.detachThemeFromItem (#214)', () => {
  it('throws for an unresolvable item id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.detachThemeFromItem({ type: 'presentation', id: 'no-such-item' }))
        .toThrow(/Item not found: no-such-item/);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op, not an error, when the item exists but already has no theme', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const itemId = createItem(repo, 'presentation', 'Untethered');
      // Freshly created items start with no theme assigned.
      const patch = repo.detachThemeFromItem({ type: 'presentation', id: itemId });
      expect(patch.upserts).toEqual({});
      expect(patch.deletes).toEqual({});
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.applyThemeToOverlay (#214)', () => {
  it('throws for an unresolvable theme id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const overlayId = createOverlay(repo);
      expect(() => repo.applyThemeToOverlay('no-such-theme', overlayId))
        .toThrow(/Theme not found: no-such-theme/);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for a theme id belonging to a different family than overlays (validity failure, not a no-op) — presentation_themes and overlay_themes are independent id spaces, so a presentation theme id is simply absent from overlay_themes', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const themeId = createTheme(repo, 'presentation');
      const overlayId = createOverlay(repo);
      expect(() => repo.applyThemeToOverlay(themeId, overlayId))
        .toThrow(new RegExp(`Theme not found: ${themeId}`));
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unresolvable overlay id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const themeId = createTheme(repo, 'overlay');
      expect(() => repo.applyThemeToOverlay(themeId, 'no-such-overlay'))
        .toThrow(/Overlay not found: no-such-overlay/);
    } finally {
      close();
      cleanup();
    }
  });

  it('applies a compatible theme to an existing overlay without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const themeId = createTheme(repo, 'overlay');
      const overlayId = createOverlay(repo);
      const patch = repo.applyThemeToOverlay(themeId, overlayId);
      expect(patch.upserts.overlays?.[0]?.id).toBe(overlayId);
    } finally {
      close();
      cleanup();
    }
  });
});
