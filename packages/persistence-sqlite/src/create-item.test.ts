import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Id } from '@lumacast/kernel';
import type { PresentationTheme, SlideBackground, SlideElement, ThemeOwnerType } from '@lumacast/composition';
import { CastRepository } from './store';

let repo: CastRepository;
let tmpDir: string;

function closeRepo(): void {
  (repo as unknown as { db: { close(): void } }).db.close();
}

function makeElement(id: Id, text: string, zIndex: number): SlideElement {
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

// One upsert key per theme family (#219 decision D2: four independent
// per-owner theme tables, no shared `themes` collection any more).
const THEME_UPSERT_KEY: Record<ThemeOwnerType, 'presentationThemes' | 'lyricThemes' | 'talkThemes' | 'overlayThemes'> = {
  presentation: 'presentationThemes',
  lyric: 'lyricThemes',
  talk: 'talkThemes',
  overlay: 'overlayThemes',
};

function createTheme(
  themeType: ThemeOwnerType,
  elements: SlideElement[],
  background: SlideBackground | null = { type: 'color', color: '#112233' },
): PresentationTheme {
  const patch = repo.createTheme({ name: `${themeType} theme`, themeType, width: 1920, height: 1080, background, elements });
  const theme = patch.upserts[THEME_UPSERT_KEY[themeType]]?.[0];
  if (!theme) throw new Error('createTheme returned no theme');
  return theme;
}

// Forces the Nth `db.prepare()` call whose SQL contains `match` to throw,
// simulating a failure partway through the atomic transaction so we can
// assert complete rollback. Restores the original `prepare` afterward.
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

describe('CastRepository.createItem', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-test-'));
    repo = new CastRepository({
      dbPath: path.join(tmpDir, 'lumacast.sqlite'),
      userDataPath: tmpDir,
      documentsPath: tmpDir,
      // These tests assert absolute counts of the items they create — an
      // unseeded database keeps those counts meaningful without hand-filtering
      // starter content out of every assertion.
      seed: false,
    });
  });

  afterEach(() => {
    closeRepo();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the created item id alongside a single patch', () => {
    const result = repo.createItem({ type: 'presentation', title: 'Deck' });
    expect(result.itemId).toBeTruthy();
    expect(result.patch.upserts.presentations?.map((p) => p.id)).toEqual([result.itemId]);
  });

  it('creates an unthemed presentation with no theme assignment and a local background', () => {
    const { itemId } = repo.createItem({ type: 'presentation', title: 'Deck' });
    const slide = repo.getSnapshot().slides.find((s) => s.presentationId === itemId);
    expect(repo.getSnapshot().presentations.find((p) => p.id === itemId)?.themeId).toBeNull();
    expect(slide?.backgroundSource).toBe('local');
    expect(slide?.background ?? null).toBeNull();
  });

  it('creates an unthemed lyric with the initial editable lyric text', () => {
    const { itemId } = repo.createItem({ type: 'lyric', title: 'Song' });
    const snapshot = repo.getSnapshot();
    const slide = snapshot.slides.find((s) => s.lyricId === itemId);
    expect(slide).toBeTruthy();
    expect(slide?.backgroundSource).toBe('local');
    const elements = snapshot.slideElements.filter((e) => e.slideId === slide!.id);
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe('text');
    expect((elements[0].payload as { text: string }).text).toContain('Lyric line');
    expect(elements[0].sourceThemeElementId ?? null).toBeNull();
  });

  it('creates an unthemed talk', () => {
    const { itemId, patch } = repo.createItem({ type: 'talk', title: 'Talk' });
    expect(patch.upserts.talks?.[0]?.id).toBe(itemId);
    expect(patch.upserts.talks?.[0]?.themeId).toBeNull();
    const slide = repo.getSnapshot().slides.find((s) => s.talkId === itemId);
    expect(slide).toBeTruthy();
    expect(slide?.backgroundSource).toBe('local');
  });

  it('creates a themed presentation whose first slide already matches the theme', () => {
    const background: SlideBackground = { type: 'color', color: '#ABCDEF' };
    const theme = createTheme('presentation', [makeElement('title-src', 'Title', 1), makeElement('subtitle-src', 'Subtitle', 2)], background);

    const { itemId } = repo.createItem({ type: 'presentation', title: 'Themed Deck', themeId: theme.id });
    const snapshot = repo.getSnapshot();
    expect(snapshot.presentations.find((p) => p.id === itemId)?.themeId).toBe(theme.id);

    const slide = snapshot.slides.find((s) => s.presentationId === itemId);
    expect(slide?.backgroundSource).toBe('theme');
    expect(slide?.background).toEqual(background);
    expect(slide?.width).toBe(theme.width);
    expect(slide?.height).toBe(theme.height);

    const slideElements = snapshot.slideElements.filter((e) => e.slideId === slide!.id);
    expect(slideElements).toHaveLength(theme.elements.length);
    const bySourceId = new Map(slideElements.map((e) => [e.sourceThemeElementId, e]));
    for (const themeElement of theme.elements) {
      const materialized = bySourceId.get(themeElement.id);
      expect(materialized).toBeTruthy();
      expect(materialized?.zIndex).toBe(themeElement.zIndex);
    }
    // Ordering preserved: sorted by z-index, the materialized elements trace
    // back to the theme elements in the same relative order.
    const orderedSourceIds = [...slideElements].sort((a, b) => a.zIndex - b.zIndex).map((e) => e.sourceThemeElementId);
    expect(orderedSourceIds).toEqual(theme.elements.map((e) => e.id));
  });

  it('creates a themed lyric whose first slide matches the lyric theme and remains editable', () => {
    const theme = createTheme('lyric', [makeElement('lyric-src', 'Verse', 1)], null);
    const { itemId } = repo.createItem({ type: 'lyric', title: 'Themed Song', themeId: theme.id });
    const snapshot = repo.getSnapshot();
    expect(snapshot.lyrics.find((l) => l.id === itemId)?.themeId).toBe(theme.id);
    const slide = snapshot.slides.find((s) => s.lyricId === itemId);
    const slideElements = snapshot.slideElements.filter((e) => e.slideId === slide!.id);
    expect(slideElements).toHaveLength(1);
    expect(slideElements[0].type).toBe('text');
    expect(slideElements[0].sourceThemeElementId).toBe(theme.elements[0].id);
  });

  it('creates a talk with its own talk theme', () => {
    const theme = createTheme('talk', [makeElement('t-src', 'Title', 1)]);
    const { itemId } = repo.createItem({ type: 'talk', title: 'Themed Talk', themeId: theme.id });
    expect(repo.getSnapshot().talks.find((t) => t.id === itemId)?.themeId).toBe(theme.id);
  });

  it('rejects a theme id from a different theme family — the four theme tables are independent id spaces (#219 D2)', () => {
    // A lyric theme id is simply absent from talk_themes; there is no
    // "compatibility" check any more, just per-table lookup.
    const lyricTheme = createTheme('lyric', [makeElement('l-src', 'Line', 1)], null);
    expect(() => repo.createItem({ type: 'talk', title: 'Bad Talk', themeId: lyricTheme.id }))
      .toThrow(/Theme not found/);
    expect(repo.getSnapshot().talks).toHaveLength(0);
  });

  it('rejects an unknown theme id and leaves no rows behind', () => {
    expect(() => repo.createItem({ type: 'presentation', title: 'Deck', themeId: 'no-such-theme' }))
      .toThrow(/Theme not found: no-such-theme/);
    expect(repo.getSnapshot().presentations).toHaveLength(0);
  });

  it('rejects an unknown playlist id and leaves no rows behind', () => {
    expect(() => repo.createItem({ type: 'presentation', title: 'Deck', playlistId: 'no-such-playlist' }))
      .toThrow(/Playlist not found: no-such-playlist/);
    expect(repo.getSnapshot().presentations).toHaveLength(0);
  });

  // ─── REQUIRED regression: nested-transaction crash fixed in wave D ──────
  // createItem's owner/slide/element insert and insertPlaylistItemRow's
  // playlist-row insert are deliberately two separate `db.transaction()`
  // calls (this sqlite wrapper's BEGIN IMMEDIATE/COMMIT does not nest) —
  // before that fix, passing a non-null playlistId nested a second
  // transaction inside the first and crashed. This must both not throw and
  // actually land the row.
  it('regression: createItem with a non-null playlistId and an explicit position does not throw and lands the playlist row', () => {
    const playlistId = repo.createPlaylist('My Playlist').upserts.playlists?.[0]?.id;
    if (!playlistId) throw new Error('no playlist');
    const { itemId: existingId } = repo.createItem({ type: 'presentation', title: 'Existing' });
    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: existingId });

    let result: ReturnType<typeof repo.createItem> | undefined;
    expect(() => {
      result = repo.createItem({ type: 'presentation', title: 'New First', playlistId, position: 0 });
    }).not.toThrow();

    const rows = repo.getSnapshot().playlistEntries.filter((e) => e.playlistId === playlistId);
    expect(rows).toHaveLength(2);
    const landedRow = rows.find((r) => r.kind === 'item' && r.presentationId === result!.itemId);
    expect(landedRow).toBeTruthy();
    expect(landedRow!.order).toBe(0);
    // The existing row shifted down to make room at position 0.
    const existingRow = rows.find((r) => r.kind === 'item' && r.presentationId === existingId);
    expect(existingRow!.order).toBe(1);

    expect(result!.patch.upserts.presentations?.some((p) => p.id === result!.itemId)).toBe(true);
    expect(result!.patch.upserts.playlistEntries?.some((e) => e.id === landedRow!.id)).toBe(true);
  });

  it('creates an item with a playlistId and no position by appending it to the playlist', () => {
    const playlistId = repo.createPlaylist('My Playlist').upserts.playlists?.[0]?.id;
    if (!playlistId) throw new Error('no playlist');
    repo.createItem({ type: 'lyric', title: 'First', playlistId });
    const { itemId: secondId } = repo.createItem({ type: 'lyric', title: 'Second', playlistId });

    const rows = repo.getSnapshot().playlistEntries.filter((e) => e.playlistId === playlistId).sort((a, b) => a.order - b.order);
    expect(rows).toHaveLength(2);
    expect(rows[1].kind).toBe('item');
    expect(rows[1].kind === 'item' && rows[1].lyricId).toBe(secondId);
  });

  it('rolls back the owner insert when slide creation fails', () => {
    const restore = failOnPrepare(repo, 'INSERT INTO slides');
    try {
      expect(() => repo.createItem({ type: 'presentation', title: 'Rollback A' })).toThrow();
    } finally {
      restore();
    }
    expect(repo.getSnapshot().presentations.some((p) => p.title === 'Rollback A')).toBe(false);
  });

  it('rolls back owner and slide when element materialization fails entirely', () => {
    const restore = failOnPrepare(repo, 'INSERT INTO slide_elements');
    try {
      expect(() => repo.createItem({ type: 'presentation', title: 'Rollback B' })).toThrow();
    } finally {
      restore();
    }
    const snapshot = repo.getSnapshot();
    expect(snapshot.presentations.some((p) => p.title === 'Rollback B')).toBe(false);
    expect(snapshot.slides).toHaveLength(0);
  });

  it('rolls back everything when a later element insert fails mid-materialization', () => {
    const theme = createTheme('presentation', [makeElement('e-1', 'First', 1), makeElement('e-2', 'Second', 2)]);
    // Baseline captured after theme creation: the theme's own container slide
    // already owns 2 slide_elements rows, which legitimately show up in the
    // unscoped snapshot.slideElements collection. Assert on the delta rather
    // than an absolute total so this test doesn't depend on how many elements
    // theme setup happens to create.
    const baselineElementCount = repo.getSnapshot().slideElements.length;
    const restore = failOnPrepare(repo, 'INSERT INTO slide_elements', 2);
    try {
      expect(() => repo.createItem({ type: 'presentation', title: 'Rollback C', themeId: theme.id })).toThrow();
    } finally {
      restore();
    }
    const snapshot = repo.getSnapshot();
    expect(snapshot.presentations.some((p) => p.title === 'Rollback C')).toBe(false);
    expect(snapshot.slides).toHaveLength(0);
    expect(snapshot.slideElements).toHaveLength(baselineElementCount);
  });

  it('publishes one patch reflecting the committed owner, slide, and elements together', () => {
    const theme = createTheme('presentation', [makeElement('sole', 'Only', 1)]);
    const { itemId, patch } = repo.createItem({ type: 'presentation', title: 'Single Patch', themeId: theme.id });
    expect(patch.upserts.presentations?.map((p) => p.id)).toEqual([itemId]);
    expect(patch.upserts.slides).toHaveLength(1);
    expect(patch.upserts.slideElements).toHaveLength(1);
  });

  it('regression: createSlide remains the operation used to add a later slide', () => {
    const { itemId } = repo.createItem({ type: 'presentation', title: 'Multi Slide Deck' });
    const before = repo.getSnapshot().slides.filter((s) => s.presentationId === itemId);
    expect(before).toHaveLength(1);

    const patch = repo.createSlide({ presentationId: itemId });
    expect(patch.upserts.slides).toHaveLength(1);

    const after = repo.getSnapshot().slides.filter((s) => s.presentationId === itemId).sort((a, b) => a.order - b.order);
    expect(after).toHaveLength(2);
    expect(after[1].order).toBeGreaterThan(after[0].order);
  });
});

// Per-type ordering (#219 decision D1): the global cross-type deck order is
// gone — movePresentation/moveLyric/moveTalk each act within exactly one
// table, replacing the old cross-type moveDeckItem.
describe('CastRepository.movePresentation / moveLyric / moveTalk — per-type ordering', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-test-'));
    repo = new CastRepository({ dbPath: path.join(tmpDir, 'lumacast.sqlite'), userDataPath: tmpDir, documentsPath: tmpDir, seed: false });
  });

  afterEach(() => {
    closeRepo();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('movePresentation swaps a presentation with its next-higher neighbor and reports only the two touched ids', () => {
    const { itemId: a } = repo.createItem({ type: 'presentation', title: 'A' });
    const { itemId: b } = repo.createItem({ type: 'presentation', title: 'B' });
    const { itemId: c } = repo.createItem({ type: 'presentation', title: 'C' });
    const orderOf = (id: Id) => repo.getSnapshot().presentations.find((p) => p.id === id)!.order;
    expect([orderOf(a), orderOf(b), orderOf(c)]).toEqual([0, 1, 2]);

    const patch = repo.movePresentation(a, 'down');
    expect(orderOf(a)).toBe(1);
    expect(orderOf(b)).toBe(0);
    expect(orderOf(c)).toBe(2);
    expect(new Set(patch.upserts.presentations?.map((p) => p.id))).toEqual(new Set([a, b]));
  });

  it('moveLyric moving the first lyric up is a no-op that changes nothing and throws nothing', () => {
    const { itemId: a } = repo.createItem({ type: 'lyric', title: 'A' });
    repo.createItem({ type: 'lyric', title: 'B' });
    const orderBefore = repo.getSnapshot().lyrics.find((l) => l.id === a)!.order;

    let patch: ReturnType<typeof repo.moveLyric> | undefined;
    expect(() => { patch = repo.moveLyric(a, 'up'); }).not.toThrow();
    expect(patch!.upserts.lyrics ?? []).toEqual([]);
    expect(repo.getSnapshot().lyrics.find((l) => l.id === a)!.order).toBe(orderBefore);
  });

  it('moveTalk throws for a missing id rather than silently no-op-ing', () => {
    expect(() => repo.moveTalk('no-such-talk', 'up')).toThrow(/Row not found in talks/);
  });

  it('moving a presentation never touches lyric or talk order (per-table isolation)', () => {
    const { itemId: p1 } = repo.createItem({ type: 'presentation', title: 'P1' });
    repo.createItem({ type: 'presentation', title: 'P2' });
    const { itemId: l1 } = repo.createItem({ type: 'lyric', title: 'L1' });
    const { itemId: l2 } = repo.createItem({ type: 'lyric', title: 'L2' });
    const lyricOrdersBefore = [l1, l2].map((id) => repo.getSnapshot().lyrics.find((l) => l.id === id)!.order);

    repo.movePresentation(p1, 'down');

    const lyricOrdersAfter = [l1, l2].map((id) => repo.getSnapshot().lyrics.find((l) => l.id === id)!.order);
    expect(lyricOrdersAfter).toEqual(lyricOrdersBefore);
  });
});

// Ported from delete-collection.test.ts (#112) — collections themselves are
// destroyed (#219 decision D3), but the underlying invariant it protected
// (deleting an owning row must cascade correctly and never leave a foreign
// -key violation behind) still applies to deleting a Presentation/Lyric/Talk
// directly, so it's re-homed here rather than dropped.
describe('CastRepository delete cascade correctness (ported from #112)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-test-'));
    repo = new CastRepository({ dbPath: path.join(tmpDir, 'lumacast.sqlite'), userDataPath: tmpDir, documentsPath: tmpDir, seed: false });
  });

  afterEach(() => {
    closeRepo();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function foreignKeyViolations(): unknown {
    return (repo as unknown as { db: { pragma: (p: string) => unknown } }).db.pragma('foreign_key_check');
  }

  it('deletePresentation cascades its slides, elements, and playlist entries with no foreign-key violations left behind', () => {
    const { itemId } = repo.createItem({ type: 'presentation', title: 'Deck' });
    const playlistId = repo.createPlaylist('Playlist').upserts.playlists?.[0]?.id;
    if (!playlistId) throw new Error('no playlist');
    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: itemId });

    const slideIds = repo.getSnapshot().slides.filter((s) => s.presentationId === itemId).map((s) => s.id);
    expect(slideIds.length).toBeGreaterThan(0);

    repo.deletePresentation(itemId);

    const snapshot = repo.getSnapshot();
    expect(snapshot.presentations.some((p) => p.id === itemId)).toBe(false);
    expect(snapshot.slides.some((s) => slideIds.includes(s.id))).toBe(false);
    expect(snapshot.slideElements.some((e) => slideIds.includes(e.slideId))).toBe(false);
    expect(snapshot.playlistEntries.some((e) => e.kind === 'item' && e.presentationId === itemId)).toBe(false);
    expect(foreignKeyViolations()).toBeUndefined();
  });

  it('deleting an item densely renormalizes the remaining items of that type to 0..n', () => {
    const { itemId: a } = repo.createItem({ type: 'presentation', title: 'A' });
    const { itemId: b } = repo.createItem({ type: 'presentation', title: 'B' });
    const { itemId: c } = repo.createItem({ type: 'presentation', title: 'C' });
    expect([a, b, c].map((id) => repo.getSnapshot().presentations.find((p) => p.id === id)!.order)).toEqual([0, 1, 2]);

    repo.deletePresentation(b);

    const remaining = repo.getSnapshot().presentations;
    expect(remaining.map((p) => p.order).sort((x, y) => x - y)).toEqual([0, 1]);
    // Relative order of survivors preserved: A still precedes C.
    expect(remaining.find((p) => p.id === a)!.order).toBeLessThan(remaining.find((p) => p.id === c)!.order);
  });

  it('deleting an item that sits in a playlist removes only its row and renormalizes the survivors densely', () => {
    const playlistId = repo.createPlaylist('Playlist').upserts.playlists?.[0]?.id;
    if (!playlistId) throw new Error('no playlist');
    const { itemId: a } = repo.createItem({ type: 'lyric', title: 'A', playlistId });
    const { itemId: b } = repo.createItem({ type: 'lyric', title: 'B', playlistId });
    const { itemId: c } = repo.createItem({ type: 'lyric', title: 'C', playlistId });

    repo.deleteLyric(b);

    const rows = repo.getSnapshot().playlistEntries.filter((e) => e.playlistId === playlistId).sort((r1, r2) => r1.order - r2.order);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.order)).toEqual([0, 1]);
    expect(rows.every((r) => r.kind === 'item')).toBe(true);
    const remainingLyricIds = rows.map((r) => r.kind === 'item' ? r.lyricId : null);
    expect(remainingLyricIds).toEqual([a, c]);
  });
});
