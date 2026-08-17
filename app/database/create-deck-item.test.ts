import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Id, SlideElement } from '@core/types';
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

function createTheme(kind: 'slides' | 'lyrics', elements: SlideElement[], background: { type: 'color'; color: string } | null = { type: 'color', color: '#112233' }) {
  const patch = repo.createTheme({ name: `${kind} theme`, kind, width: 1920, height: 1080, background, elements });
  const theme = patch.upserts.themes?.[0];
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

describe('CastRepository.createDeckItemWithFirstSlide', () => {
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

  it('returns the created owner id alongside a single patch', () => {
    const result = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck' });
    expect(result.itemId).toBeTruthy();
    expect(result.patch.upserts.presentations?.map((p) => p.id)).toEqual([result.itemId]);
  });

  it('creates an unthemed presentation with no theme assignment and a local background', () => {
    const { itemId, patch } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck' });
    expect(patch.upserts.presentations?.[0]?.themeId).toBeNull();
    const slide = repo.getSnapshot().slides.find((s) => s.presentationId === itemId);
    expect(slide?.backgroundSource).toBe('local');
    expect(slide?.background ?? null).toBeNull();
  });

  it('creates an unthemed lyric with the initial editable lyric text', () => {
    const { itemId } = repo.createDeckItemWithFirstSlide({ type: 'lyric', title: 'Song' });
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
    const { itemId, patch } = repo.createDeckItemWithFirstSlide({ type: 'talk', title: 'Talk' });
    expect(patch.upserts.talks?.[0]?.id).toBe(itemId);
    expect(patch.upserts.talks?.[0]?.themeId).toBeNull();
    const slide = repo.getSnapshot().slides.find((s) => s.talkId === itemId);
    expect(slide).toBeTruthy();
    expect(slide?.backgroundSource).toBe('local');
  });

  it('creates a themed presentation whose first slide already matches the theme', () => {
    const background = { type: 'color' as const, color: '#ABCDEF' };
    const theme = createTheme('slides', [makeElement('title-src', 'Title', 1), makeElement('subtitle-src', 'Subtitle', 2)], background);

    const { itemId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Themed Deck', themeId: theme.id });
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
    const theme = createTheme('lyrics', [makeElement('lyric-src', 'Verse', 1)], null);
    const { itemId } = repo.createDeckItemWithFirstSlide({ type: 'lyric', title: 'Themed Song', themeId: theme.id });
    const snapshot = repo.getSnapshot();
    expect(snapshot.lyrics.find((l) => l.id === itemId)?.themeId).toBe(theme.id);
    const slide = snapshot.slides.find((s) => s.lyricId === itemId);
    const slideElements = snapshot.slideElements.filter((e) => e.slideId === slide!.id);
    expect(slideElements).toHaveLength(1);
    expect(slideElements[0].type).toBe('text');
    expect(slideElements[0].sourceThemeElementId).toBe(theme.elements[0].id);
  });

  it('creates a talk with a compatible slides theme', () => {
    const theme = createTheme('slides', [makeElement('t-src', 'Title', 1)]);
    const { itemId } = repo.createDeckItemWithFirstSlide({ type: 'talk', title: 'Themed Talk', themeId: theme.id });
    expect(repo.getSnapshot().talks.find((t) => t.id === itemId)?.themeId).toBe(theme.id);
  });

  it('rejects a talk with an incompatible lyric theme and leaves no rows behind', () => {
    const theme = createTheme('lyrics', [makeElement('l-src', 'Line', 1)], null);
    expect(() => repo.createDeckItemWithFirstSlide({ type: 'talk', title: 'Bad Talk', themeId: theme.id }))
      .toThrow(/not compatible/);
    expect(repo.getSnapshot().talks).toHaveLength(0);
  });

  it('rejects an unknown theme id and leaves no rows behind', () => {
    expect(() => repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck', themeId: 'no-such-theme' }))
      .toThrow(/Theme not found: no-such-theme/);
    expect(repo.getSnapshot().presentations).toHaveLength(0);
  });

  it('rejects an unknown collection id and leaves no rows behind', () => {
    expect(() => repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck', collectionId: 'no-such-collection' }))
      .toThrow(/Collection not found: no-such-collection/);
    expect(repo.getSnapshot().presentations).toHaveLength(0);
  });

  it('rejects an invalid deck item type', () => {
    expect(() => repo.createDeckItemWithFirstSlide({ type: 'bogus' as never, title: 'Deck' }))
      .toThrow(/Invalid deck item type/);
  });

  it('rejects an empty title', () => {
    expect(() => repo.createDeckItemWithFirstSlide({ type: 'presentation', title: '   ' }))
      .toThrow(/Title is required/);
  });

  it('rejects an unknown group id and leaves no rows behind', () => {
    expect(() => repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck', groupId: 'no-such-group' }))
      .toThrow(/Group not found: no-such-group/);
    expect(repo.getSnapshot().presentations).toHaveLength(0);
  });

  it('adds the created item to the given playlist group in the same transaction', () => {
    const libraryId = repo.createLibrary('Lib').upserts.libraries?.[0]?.id;
    if (!libraryId) throw new Error('no library');
    repo.createPlaylist(libraryId, 'Playlist');
    const playlistId = repo.getSnapshot().libraryBundles
      .find((b) => b.library.id === libraryId)?.playlists[0]?.playlist.id;
    if (!playlistId) throw new Error('no playlist');
    repo.createPlaylistGroup(playlistId, 'Group');
    const groupId = repo.getSnapshot().libraryBundles
      .find((b) => b.library.id === libraryId)?.playlists
      .find((p) => p.playlist.id === playlistId)?.groups[0]?.group.id;
    if (!groupId) throw new Error('no group');

    const { itemId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Grouped Deck', groupId });

    const snapshot = repo.getSnapshot();
    const tree = snapshot.libraryBundles.find((b) => b.library.id === libraryId)?.playlists.find((p) => p.playlist.id === playlistId);
    const group = tree?.groups.find((g) => g.group.id === groupId);
    expect(group?.entries.some((e) => e.item.id === itemId)).toBe(true);
  });

  it('rolls back the owner insert when slide creation fails', () => {
    const restore = failOnPrepare(repo, 'INSERT INTO slides');
    try {
      expect(() => repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Rollback A' })).toThrow();
    } finally {
      restore();
    }
    expect(repo.getSnapshot().presentations.some((p) => p.title === 'Rollback A')).toBe(false);
  });

  it('rolls back owner and slide when element materialization fails entirely', () => {
    const restore = failOnPrepare(repo, 'INSERT INTO slide_elements');
    try {
      expect(() => repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Rollback B' })).toThrow();
    } finally {
      restore();
    }
    const snapshot = repo.getSnapshot();
    expect(snapshot.presentations.some((p) => p.title === 'Rollback B')).toBe(false);
    expect(snapshot.slides).toHaveLength(0);
  });

  it('rolls back everything when a later element insert fails mid-materialization', () => {
    const theme = createTheme('slides', [makeElement('e-1', 'First', 1), makeElement('e-2', 'Second', 2)]);
    // Baseline captured after theme creation: the theme's own container slide
    // already owns 2 slide_elements rows, which legitimately show up in the
    // unscoped snapshot.slideElements collection. Assert on the delta rather
    // than an absolute total so this test doesn't depend on how many elements
    // theme setup happens to create.
    const baselineElementCount = repo.getSnapshot().slideElements.length;
    const restore = failOnPrepare(repo, 'INSERT INTO slide_elements', 2);
    try {
      expect(() => repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Rollback C', themeId: theme.id })).toThrow();
    } finally {
      restore();
    }
    const snapshot = repo.getSnapshot();
    expect(snapshot.presentations.some((p) => p.title === 'Rollback C')).toBe(false);
    expect(snapshot.slides).toHaveLength(0);
    expect(snapshot.slideElements).toHaveLength(baselineElementCount);
  });

  it('publishes one patch reflecting the committed owner, slide, and elements together', () => {
    const theme = createTheme('slides', [makeElement('sole', 'Only', 1)]);
    const { itemId, patch } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Single Patch', themeId: theme.id });
    expect(patch.upserts.presentations?.map((p) => p.id)).toEqual([itemId]);
    expect(patch.upserts.slides).toHaveLength(1);
    expect(patch.upserts.slideElements).toHaveLength(1);
  });

  it('keeps createDeckItemWithTheme (legacy wrapper) returning a raw SnapshotPatch for existing callers', () => {
    const patch = repo.createDeckItemWithTheme({ type: 'presentation', title: 'Legacy Path' });
    expect(patch.upserts.presentations?.[0]?.title).toBe('Legacy Path');
  });

  it('regression: createSlide remains the operation used to add a later slide', () => {
    const { itemId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Multi Slide Deck' });
    const before = repo.getSnapshot().slides.filter((s) => s.presentationId === itemId);
    expect(before).toHaveLength(1);

    const patch = repo.createSlide({ presentationId: itemId });
    expect(patch.upserts.slides).toHaveLength(1);

    const after = repo.getSnapshot().slides.filter((s) => s.presentationId === itemId).sort((a, b) => a.order - b.order);
    expect(after).toHaveLength(2);
    expect(after[1].order).toBeGreaterThan(after[0].order);
  });
});
