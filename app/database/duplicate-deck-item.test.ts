import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Id, SlideElement, TextElementPayload } from '@core/types';
import { CastRepository, DeckItemDuplicationError } from './store';

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

describe('CastRepository.duplicateDeckItem', () => {
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

  // ─── Identity: new owner, new slides, new elements ──────────────────

  it('returns the duplicate owner id alongside a single patch', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck' });
    const result = repo.duplicateDeckItem(sourceId);
    expect(result.itemId).toBeTruthy();
    expect(result.itemId).not.toBe(sourceId);
    expect(result.patch.upserts.presentations?.map((p) => p.id)).toContain(result.itemId);
  });

  it('gives a presentation duplicate a new owner id, new slide ids, and new element ids', () => {
    const theme = createTheme('slides', [makeElement('t-1', 'Title', 1), makeElement('t-2', 'Subtitle', 2)]);
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck', themeId: theme.id });
    const { itemId: duplicateId } = repo.duplicateDeckItem(sourceId);

    const snapshot = repo.getSnapshot();
    const sourceSlide = snapshot.slides.find((s) => s.presentationId === sourceId)!;
    const duplicateSlide = snapshot.slides.find((s) => s.presentationId === duplicateId)!;
    expect(duplicateSlide.id).not.toBe(sourceSlide.id);

    const sourceElements = snapshot.slideElements.filter((e) => e.slideId === sourceSlide.id);
    const duplicateElements = snapshot.slideElements.filter((e) => e.slideId === duplicateSlide.id);
    expect(duplicateElements).toHaveLength(sourceElements.length);
    const duplicateIds = new Set(duplicateElements.map((e) => e.id));
    for (const sourceElement of sourceElements) {
      expect(duplicateIds.has(sourceElement.id)).toBe(false);
    }
  });

  it('gives a lyric duplicate a new owner id, new slide ids, and independently editable lyric text', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'lyric', title: 'Song' });
    const { itemId: duplicateId } = repo.duplicateDeckItem(sourceId);
    expect(duplicateId).not.toBe(sourceId);

    const snapshot = repo.getSnapshot();
    const duplicateSlide = snapshot.slides.find((s) => s.lyricId === duplicateId)!;
    const duplicateElement = snapshot.slideElements.find((e) => e.slideId === duplicateSlide.id)!;

    repo.updateElement({ id: duplicateElement.id, payload: { ...(duplicateElement.payload as TextElementPayload), text: 'Edited only on duplicate' } });

    const after = repo.getSnapshot();
    const sourceSlide = after.slides.find((s) => s.lyricId === sourceId)!;
    const sourceElement = after.slideElements.find((e) => e.slideId === sourceSlide.id)!;
    expect((sourceElement.payload as { text: string }).text).not.toBe('Edited only on duplicate');
  });

  // ─── Zero-slide owners ───────────────────────────────────────────────

  it('duplicates a zero-slide presentation as a zero-slide owner', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Empty Deck' });
    const onlySlide = repo.getSnapshot().slides.find((s) => s.presentationId === sourceId)!;
    repo.deleteSlide(onlySlide.id);
    expect(repo.getSnapshot().slides.filter((s) => s.presentationId === sourceId)).toHaveLength(0);

    const { itemId: duplicateId } = repo.duplicateDeckItem(sourceId);
    expect(repo.getSnapshot().slides.filter((s) => s.presentationId === duplicateId)).toHaveLength(0);
    expect(repo.getSnapshot().presentations.some((p) => p.id === duplicateId)).toBe(true);
  });

  it('duplicates a zero-slide lyric exactly, without inventing lyric content', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'lyric', title: 'Empty Song' });
    const onlySlide = repo.getSnapshot().slides.find((s) => s.lyricId === sourceId)!;
    repo.deleteSlide(onlySlide.id);

    const { itemId: duplicateId } = repo.duplicateDeckItem(sourceId);
    const snapshot = repo.getSnapshot();
    expect(snapshot.slides.filter((s) => s.lyricId === duplicateId)).toHaveLength(0);
    // No slides means no elements either — nothing was synthesized.
    expect(snapshot.slideElements).toHaveLength(0);
  });

  // ─── Materialized content: backgrounds, notes, mixed elements, z-order, media ──

  it('copies background, notes, mixed element kinds, and z-order exactly, preserving managed media references without duplicating media', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Rich Deck' });
    const sourceSlide = repo.getSnapshot().slides.find((s) => s.presentationId === sourceId)!;

    repo.updateSlideNotes({ slideId: sourceSlide.id, notes: 'Speaker notes' });
    repo.updateSlideBackground({
      slideId: sourceSlide.id,
      background: { type: 'image', mediaAssetId: 'media-asset-1', src: 'asset://media-asset-1.png', fit: 'cover' },
    });
    repo.createElement({ slideId: sourceSlide.id, type: 'shape', x: 10, y: 10, width: 50, height: 50, zIndex: 5, payload: { fillColor: '#FF0000', borderColor: '#000000', borderWidth: 1, borderRadius: 4 } });
    repo.createElement({ slideId: sourceSlide.id, type: 'image', x: 20, y: 20, width: 80, height: 80, zIndex: 1, payload: { src: 'asset://media-asset-2.png' } });

    const mediaAssetCountBefore = repo.getSnapshot().mediaAssets.length;
    const { itemId: duplicateId } = repo.duplicateDeckItem(sourceId);

    const snapshot = repo.getSnapshot();
    const duplicateSlide = snapshot.slides.find((s) => s.presentationId === duplicateId)!;
    expect(duplicateSlide.notes).toBe('Speaker notes');
    expect(duplicateSlide.background).toEqual({ type: 'image', mediaAssetId: 'media-asset-1', src: 'asset://media-asset-1.png', fit: 'cover' });
    expect(duplicateSlide.backgroundSource).toBe('local');

    const sourceElements = snapshot.slideElements.filter((e) => e.slideId === sourceSlide.id).sort((a, b) => a.zIndex - b.zIndex);
    const duplicateElements = snapshot.slideElements.filter((e) => e.slideId === duplicateSlide.id).sort((a, b) => a.zIndex - b.zIndex);
    expect(duplicateElements.map((e) => ({ type: e.type, zIndex: e.zIndex, payload: e.payload }))).toEqual(
      sourceElements.map((e) => ({ type: e.type, zIndex: e.zIndex, payload: e.payload })),
    );
    // No media files/records are duplicated — only the reference is copied.
    expect(repo.getSnapshot().mediaAssets.length).toBe(mediaAssetCountBefore);
  });

  // ─── Theme assignment retained without resync ───────────────────────

  it('retains the source theme assignment without reapplying or resyncing it, and preserves local overrides made after the theme changed', () => {
    const theme = createTheme('slides', [makeElement('orig', 'Original', 1)], { type: 'color', color: '#111111' });
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Themed Deck', themeId: theme.id });
    const sourceSlideBefore = repo.getSnapshot().slides.find((s) => s.presentationId === sourceId)!;

    // Local override after theme application.
    repo.updateSlideBackground({ slideId: sourceSlideBefore.id, background: { type: 'color', color: '#ABCDEF' } });

    // Theme changes afterward; source is never resynced (syncThemeToLinkedDeckItems not called).
    repo.updateTheme({ id: theme.id, elements: [makeElement('new', 'Completely different', 9)] });

    const sourceSnapshotBeforeDuplicate = repo.getSnapshot();
    const sourceSlide = sourceSnapshotBeforeDuplicate.slides.find((s) => s.presentationId === sourceId)!;
    const sourceElements = sourceSnapshotBeforeDuplicate.slideElements.filter((e) => e.slideId === sourceSlide.id);

    const { itemId: duplicateId } = repo.duplicateDeckItem(sourceId);

    const snapshot = repo.getSnapshot();
    expect(snapshot.presentations.find((p) => p.id === duplicateId)?.themeId).toBe(theme.id);
    const duplicateSlide = snapshot.slides.find((s) => s.presentationId === duplicateId)!;
    // Exact copy of the stale, locally-overridden slide — not the latest theme.
    expect(duplicateSlide.background).toEqual({ type: 'color', color: '#ABCDEF' });
    expect(duplicateSlide.backgroundSource).toBe(sourceSlide.backgroundSource);
    const duplicateElements = snapshot.slideElements.filter((e) => e.slideId === duplicateSlide.id);
    expect(duplicateElements.map((e) => (e.payload as { text: string }).text)).toEqual(
      sourceElements.map((e) => (e.payload as { text: string }).text),
    );
    expect(duplicateElements.some((e) => (e.payload as { text: string }).text === 'Completely different')).toBe(false);
  });

  it('duplicates an unthemed source with a null theme assignment', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Unthemed' });
    const { itemId: duplicateId } = repo.duplicateDeckItem(sourceId);
    expect(repo.getSnapshot().presentations.find((p) => p.id === duplicateId)?.themeId ?? null).toBeNull();
  });

  // ─── Collection preservation and ordering ───────────────────────────

  it('preserves collection membership on the duplicate', () => {
    const collectionId = repo.createCollection({ binKind: 'deck', name: 'Custom Collection' }).upserts.collections?.[0]?.id;
    if (!collectionId) throw new Error('no collection');
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck', collectionId });
    const { itemId: duplicateId } = repo.duplicateDeckItem(sourceId);
    expect(repo.getSnapshot().presentations.find((p) => p.id === duplicateId)?.collectionId).toBe(collectionId);
  });

  it('inserts the duplicate immediately after the source and shifts only later siblings, at first/middle/last position', () => {
    const { itemId: a } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'A' });
    const { itemId: b } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'B' });
    const { itemId: c } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'C' });
    const orderOf = (id: Id) => repo.getSnapshot().presentations.find((p) => p.id === id)!.order;
    expect([orderOf(a), orderOf(b), orderOf(c)]).toEqual([0, 1, 2]);

    // Duplicate the middle item: C shifts, A stays.
    const { itemId: bCopy } = repo.duplicateDeckItem(b);
    expect(orderOf(a)).toBe(0);
    expect(orderOf(b)).toBe(1);
    expect(orderOf(bCopy)).toBe(2);
    expect(orderOf(c)).toBe(3);

    // Duplicate the first item: everything after shifts by one more.
    const { itemId: aCopy } = repo.duplicateDeckItem(a);
    expect(orderOf(a)).toBe(0);
    expect(orderOf(aCopy)).toBe(1);
    expect(orderOf(b)).toBe(2);
    expect(orderOf(bCopy)).toBe(3);
    expect(orderOf(c)).toBe(4);

    // Duplicate the last item: nothing else shifts.
    const { itemId: cCopy } = repo.duplicateDeckItem(c);
    expect(orderOf(c)).toBe(4);
    expect(orderOf(cCopy)).toBe(5);
  });

  it('does not shift order_index of items in unrelated collections', () => {
    const otherCollectionId = repo.createCollection({ binKind: 'deck', name: 'Other Collection' }).upserts.collections?.[0]?.id;
    if (!otherCollectionId) throw new Error('no collection');

    // Other collection gets an item at order 1 — the same order_index value
    // that will fall inside the shift range below. order_index is a
    // per-(type, collection) sequence, so this item must be untouched by a
    // duplication that happens entirely within the default collection.
    repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Other Collection Item 0', collectionId: otherCollectionId });
    const { itemId: otherId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Other Collection Item 1', collectionId: otherCollectionId });
    const otherOrderBefore = repo.getSnapshot().presentations.find((p) => p.id === otherId)!.order;
    expect(otherOrderBefore).toBe(1);

    // Source is the first item in the default collection (order 0); its
    // shift range (order_index >= 1) collides with otherId's order_index
    // in the unscoped/buggy implementation, even though they're unrelated.
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Default Collection Item' });
    repo.duplicateDeckItem(sourceId);

    const otherOrderAfter = repo.getSnapshot().presentations.find((p) => p.id === otherId)!.order;
    expect(otherOrderAfter).toBe(otherOrderBefore);
  });

  // ─── Deterministic, case-insensitive copy naming ────────────────────

  it('generates deterministic, case-insensitive unique copy titles through at least Copy 3', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck' });

    const first = repo.duplicateDeckItem(sourceId);
    expect(repo.getSnapshot().presentations.find((p) => p.id === first.itemId)?.title).toBe('Deck Copy');

    // Pre-seed a case-variant collision so the second duplicate must skip to "Copy 2".
    repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'deck copy' });
    const second = repo.duplicateDeckItem(sourceId);
    expect(repo.getSnapshot().presentations.find((p) => p.id === second.itemId)?.title).toBe('Deck Copy 2');

    repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'DECK COPY 2' });
    const third = repo.duplicateDeckItem(sourceId);
    expect(repo.getSnapshot().presentations.find((p) => p.id === third.itemId)?.title).toBe('Deck Copy 3');
  });

  // ─── Source-not-found and unsupported Talk input ────────────────────

  it('rejects a missing source id', () => {
    expect(() => repo.duplicateDeckItem('no-such-item')).toThrow(/Deck item not found/);
  });

  it('rejects a Talk source with a typed unsupported-operation error before any writes', () => {
    const { itemId: talkId } = repo.createDeckItemWithFirstSlide({ type: 'talk', title: 'Talk' });
    const talksBefore = repo.getSnapshot().talks.length;

    let caught: unknown;
    try {
      repo.duplicateDeckItem(talkId);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DeckItemDuplicationError);
    expect((caught as DeckItemDuplicationError).code).toBe('unsupported-owner-type');
    expect(repo.getSnapshot().talks.length).toBe(talksBefore);
  });

  // ─── Transaction rollback on forced failure ─────────────────────────

  it('rolls back the sibling shift and produces no partial owner when the owner insert fails', () => {
    const { itemId: a } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'A' });
    const { itemId: b } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'B' });
    const bOrderBefore = repo.getSnapshot().presentations.find((p) => p.id === b)!.order;

    const restore = failOnPrepare(repo, 'INSERT INTO presentations');
    try {
      expect(() => repo.duplicateDeckItem(a)).toThrow();
    } finally {
      restore();
    }

    const snapshot = repo.getSnapshot();
    expect(snapshot.presentations.some((p) => p.title === 'A Copy')).toBe(false);
    expect(snapshot.presentations.find((p) => p.id === b)!.order).toBe(bOrderBefore);
  });

  it('rolls back the owner insert when slide creation fails', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck' });

    const restore = failOnPrepare(repo, 'INSERT INTO slides');
    try {
      expect(() => repo.duplicateDeckItem(sourceId)).toThrow();
    } finally {
      restore();
    }

    const snapshot = repo.getSnapshot();
    expect(snapshot.presentations.some((p) => p.title === 'Deck Copy')).toBe(false);
    expect(snapshot.presentations).toHaveLength(1);
    expect(snapshot.slides).toHaveLength(1);
  });

  it('rolls back owner and slides when element materialization fails mid-copy', () => {
    const theme = createTheme('slides', [makeElement('e-1', 'First', 1), makeElement('e-2', 'Second', 2)]);
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck', themeId: theme.id });

    // occurrence 2: let the first element insert of the duplication succeed, then fail.
    const restore = failOnPrepare(repo, 'INSERT INTO slide_elements', 2);
    try {
      expect(() => repo.duplicateDeckItem(sourceId)).toThrow();
    } finally {
      restore();
    }

    const snapshot = repo.getSnapshot();
    expect(snapshot.presentations.some((p) => p.title === 'Deck Copy')).toBe(false);
    expect(snapshot.slides.filter((s) => s.presentationId !== sourceId)).toHaveLength(0);
    // Source's own elements survive untouched.
    const sourceSlide = snapshot.slides.find((s) => s.presentationId === sourceId)!;
    expect(snapshot.slideElements.filter((e) => e.slideId === sourceSlide.id)).toHaveLength(2);
  });

  // ─── Source/duplicate independence ───────────────────────────────────

  it('keeps source and duplicate independent after editing either one', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck' });
    const { itemId: duplicateId } = repo.duplicateDeckItem(sourceId);

    const sourceSlide = repo.getSnapshot().slides.find((s) => s.presentationId === sourceId)!;
    const duplicateSlide = repo.getSnapshot().slides.find((s) => s.presentationId === duplicateId)!;

    repo.updateSlideNotes({ slideId: sourceSlide.id, notes: 'Source notes' });
    repo.updateSlideNotes({ slideId: duplicateSlide.id, notes: 'Duplicate notes' });

    const snapshot = repo.getSnapshot();
    expect(snapshot.slides.find((s) => s.id === sourceSlide.id)?.notes).toBe('Source notes');
    expect(snapshot.slides.find((s) => s.id === duplicateSlide.id)?.notes).toBe('Duplicate notes');
  });

  it('deleting the source does not remove the duplicate, and vice versa', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck' });
    const { itemId: duplicateId } = repo.duplicateDeckItem(sourceId);

    repo.deletePresentation(sourceId);
    let snapshot = repo.getSnapshot();
    expect(snapshot.presentations.some((p) => p.id === sourceId)).toBe(false);
    expect(snapshot.presentations.some((p) => p.id === duplicateId)).toBe(true);
    expect(snapshot.slides.some((s) => s.presentationId === duplicateId)).toBe(true);

    repo.deletePresentation(duplicateId);
    snapshot = repo.getSnapshot();
    expect(snapshot.presentations.some((p) => p.id === duplicateId)).toBe(false);
  });

  // ─── Regression: duplicateSlide is unaffected ───────────────────────

  it('regression: duplicateSlide remains an exact single-slide copy, unaffected by whole-deck duplication', () => {
    const { itemId: sourceId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck' });
    const slide = repo.getSnapshot().slides.find((s) => s.presentationId === sourceId)!;
    repo.updateSlideNotes({ slideId: slide.id, notes: 'Notes to copy' });

    const patch = repo.duplicateSlide(slide.id);
    const newSlideId = patch.upserts.slides?.find((s) => s.id !== slide.id)?.id;
    expect(newSlideId).toBeTruthy();

    const snapshot = repo.getSnapshot();
    const slidesForOwner = snapshot.slides.filter((s) => s.presentationId === sourceId);
    expect(slidesForOwner).toHaveLength(2);
    const duplicatedSlide = slidesForOwner.find((s) => s.id === newSlideId)!;
    expect(duplicatedSlide.notes).toBe('Notes to copy');
    // duplicateSlide never creates a new owner.
    expect(snapshot.presentations).toHaveLength(1);
  });
});
