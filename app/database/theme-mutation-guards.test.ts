import { describe, expect, it } from 'vitest';
import type { Id } from '@core/types';
import type { CastRepository } from './store';
import { createTestRepository } from './test-support';

// Covers the theme/overlay slice of #214: `updateTheme`,
// `detachThemeFromDeckItem`, and `applyThemeToOverlay` each had a branch
// that silently returned an empty patch when an id failed to resolve, even
// though a sibling method in this file (`applyThemeToDeckItem`,
// `syncThemeToLinkedDeckItems`) already throws `Theme not found`/`Deck item
// not found` for the identical lookup failure. Group 1 (2bcdedf) converted
// the missing-theme branch of `applyThemeToOverlay`; group 2 converts its
// two remaining silent branches: an incompatible theme — a validity failure
// mirroring `applyThemeToDeckItem`'s compatibility throw, not a missing
// lookup — and an unresolvable overlay. These tests pin the fixed contract
// for all three branches, and separately pin that the one genuine no-op
// this issue leaves alone (already-untethered theme) still returns an empty
// patch without throwing.

function createDeckItem(repo: CastRepository, type: 'presentation' | 'lyric' | 'talk', title: string): Id {
  const patch = repo.createDeckItemWithTheme({ type, title });
  const key = type === 'presentation' ? 'presentations' : type === 'lyric' ? 'lyrics' : 'talks';
  const item = patch.upserts[key]?.[0];
  if (!item) throw new Error(`createDeckItemWithTheme returned no ${key} item`);
  return item.id;
}

function createTheme(repo: CastRepository, kind: 'slides' | 'lyrics' | 'overlays', name = 'Theme'): Id {
  const patch = repo.createTheme({ name, kind });
  const theme = patch.upserts.themes?.[0];
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
      expect(() => repo.updateTheme({ id: 'no-such-theme', name: 'New name' }))
        .toThrow(/Theme not found: no-such-theme/);
    } finally {
      close();
      cleanup();
    }
  });

  it('updates an existing theme without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const themeId = createTheme(repo, 'slides');
      const patch = repo.updateTheme({ id: themeId, name: 'Renamed' });
      expect(patch.upserts.themes?.[0]?.name).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.detachThemeFromDeckItem (#214)', () => {
  it('throws for an unresolvable deck item id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.detachThemeFromDeckItem('no-such-item'))
        .toThrow(/Deck item not found: no-such-item/);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op, not an error, when the item exists but already has no theme', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const itemId = createDeckItem(repo, 'presentation', 'Untethered');
      // Freshly created deck items start with no theme assigned.
      const patch = repo.detachThemeFromDeckItem(itemId);
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

  it('throws for a theme incompatible with overlays (validity failure, not a no-op)', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      // 'slides' themes are not compatible with overlays; both ids resolve
      // but the apply can never succeed, mirroring `applyThemeToDeckItem`'s
      // compatibility throw.
      const themeId = createTheme(repo, 'slides');
      const overlayId = createOverlay(repo);
      expect(() => repo.applyThemeToOverlay(themeId, overlayId))
        .toThrow(/Theme kind 'slides' is not compatible with overlay/);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unresolvable overlay id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const themeId = createTheme(repo, 'overlays');
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
      const themeId = createTheme(repo, 'overlays');
      const overlayId = createOverlay(repo);
      const patch = repo.applyThemeToOverlay(themeId, overlayId);
      expect(patch.upserts.overlays?.[0]?.id).toBe(overlayId);
    } finally {
      close();
      cleanup();
    }
  });
});
