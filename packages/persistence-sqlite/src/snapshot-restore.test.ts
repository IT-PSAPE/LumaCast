// Regression coverage for `restoreFromSnapshot` (ported/rewritten for the
// #219 item-model refactor -- collections and libraries, the subject of the
// original #208 fixture, no longer exist; see DESIGN.md D3/D4).
//
// The live defect this file pins down (found + fixed during the wave-D store
// rewrite, see the accompanying report's "runtime defects found+fixed"
// note): `restoreFromSnapshot` deletes every application-owned table before
// reinserting the snapshot's rows, all inside one transaction with foreign
// keys ON. If a live item (`presentations`/`lyrics`/`talks`) currently has a
// theme applied -- so its `theme_id` column really does reference a live row
// in one of the four per-owner theme tables -- the DELETE statements must
// run in strict child-before-parent order (items before their theme table)
// or SQLite's immediate FK enforcement throws `FOREIGN KEY constraint
// failed` mid-transaction, an undo that should have been silent instead
// crashing the whole operation. This is exactly the "undo while a theme is
// applied" path a user hits constantly (apply a theme, then Cmd+Z).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CastRepository } from './store';

type RawDb = {
  prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown };
  close(): void;
};

function rawDb(target: CastRepository): RawDb {
  return (target as unknown as { db: RawDb }).db;
}

function makeRepo(dir: string): CastRepository {
  return new CastRepository({ dbPath: path.join(dir, 'lumacast.sqlite'), userDataPath: dir, documentsPath: dir, seed: false });
}

function closeRepo(target: CastRepository): void {
  rawDb(target).close();
}

function foreignKeyViolations(target: CastRepository): unknown[] {
  return rawDb(target).prepare('PRAGMA foreign_key_check').all();
}

describe('restoreFromSnapshot (#219 item-model refactor)', () => {
  let sourceDir: string;
  let destDir: string;
  let source: CastRepository;
  let dest: CastRepository;

  beforeEach(() => {
    sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-snapshot-source-'));
    destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-snapshot-dest-'));
    source = makeRepo(sourceDir);
    dest = makeRepo(destDir);
  });

  afterEach(() => {
    closeRepo(source);
    closeRepo(dest);
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(destDir, { recursive: true, force: true });
  });

  it('restores over a live database where the CURRENT item still has an applied theme (child-before-parent delete-order regression)', () => {
    const theme = source.createTheme({ name: 'Brand', themeType: 'presentation' }).upserts.presentationThemes![0]!;
    const { itemId: presentationId } = source.createItem({ type: 'presentation', title: 'Slides', themeId: theme.id });
    // Sanity: the live row really does carry a foreign key into the theme table.
    expect(
      (rawDb(source).prepare('SELECT theme_id FROM presentations WHERE id = ?').get(presentationId) as { theme_id: string }).theme_id,
    ).toBe(theme.id);

    const before = source.getSnapshot();

    // Mutate after the snapshot: a second, still-themed presentation exists
    // in the live database at the moment restoreFromSnapshot runs, so the
    // themed relationship is live on BOTH sides of the delete-then-insert.
    source.createItem({ type: 'presentation', title: 'Extra', themeId: theme.id });

    expect(() => source.restoreFromSnapshot(before)).not.toThrow();

    const restored = source.getSnapshot();
    expect(restored.presentations.map((p) => p.id)).toEqual([presentationId]);
    expect(restored.presentations[0]!.themeId).toBe(theme.id);
    expect(restored.presentationThemes.map((t) => t.id)).toEqual([theme.id]);
    expect(foreignKeyViolations(source)).toEqual([]);
  });

  it('restores over a live database where a talk still has an applied talk theme', () => {
    const talkTheme = source.createTheme({ name: 'Sermon Theme', themeType: 'talk' }).upserts.talkThemes![0]!;
    const { itemId: talkId } = source.createItem({ type: 'talk', title: 'Sermon', themeId: talkTheme.id });
    const before = source.getSnapshot();

    source.createItem({ type: 'talk', title: 'Another Sermon', themeId: talkTheme.id });

    expect(() => source.restoreFromSnapshot(before)).not.toThrow();

    const restored = source.getSnapshot();
    expect(restored.talks.map((t) => t.id)).toEqual([talkId]);
    expect(restored.talks[0]!.themeId).toBe(talkTheme.id);
    expect(foreignKeyViolations(source)).toEqual([]);
  });

  it('same-database undo/redo round trips a snapshot back into the repository that produced it', () => {
    const presentationId = source.createItem({ type: 'presentation', title: 'Slides' }).itemId;
    const snapshot = source.getSnapshot();

    source.createItem({ type: 'talk', title: 'Sermon added after snapshot' });
    source.createPlaylist('Extra');

    expect(() => source.restoreFromSnapshot(snapshot)).not.toThrow();

    const restored = source.getSnapshot();
    expect(restored.presentations.map((p) => p.id)).toEqual(snapshot.presentations.map((p) => p.id));
    expect(restored.presentations.map((p) => p.id)).toContain(presentationId);
    expect(restored.talks).toHaveLength(0);
    expect(restored.playlists.map((p) => p.id).sort()).toEqual(snapshot.playlists.map((p) => p.id).sort());
    expect(foreignKeyViolations(source)).toEqual([]);
  });

  it('restores cleanly into a different, independently seeded repository', () => {
    const presentationId = source.createItem({ type: 'presentation', title: 'Slides' }).itemId;
    dest.createPlaylist('Destination-only playlist');
    const snapshot = source.getSnapshot();

    expect(() => dest.restoreFromSnapshot(snapshot)).not.toThrow();

    const restored = dest.getSnapshot();
    expect(restored.presentations.map((p) => p.id)).toContain(presentationId);
    // The destination's own pre-restore content is gone -- restore replaces
    // the whole database, it does not merge.
    expect(restored.playlists.some((p) => p.name === 'Destination-only playlist')).toBe(false);
    expect(foreignKeyViolations(dest)).toEqual([]);
  });

  it('restores cleanly across a same-database theme deletion (snapshot predates the delete)', () => {
    const theme = source.createTheme({ name: 'Brand', themeType: 'presentation' }).upserts.presentationThemes![0]!;
    const presentationId = source.createItem({ type: 'presentation', title: 'Slides', themeId: theme.id }).itemId;

    const preDeletionSnapshot = source.getSnapshot();
    expect(preDeletionSnapshot.presentations.find((p) => p.id === presentationId)!.themeId).toBe(theme.id);

    // Delete the theme: the item's themeId is nulled and the theme row is
    // really gone (not re-seeded under a new id -- there is no self-seeded
    // fallback for a deleted theme the way collections used to have).
    source.deleteTheme(theme.id, 'presentation');
    expect(source.getSnapshot().presentationThemes.map((t) => t.id)).not.toContain(theme.id);

    // Undo: restore the snapshot captured before the deletion, on the same
    // repository/database that produced it.
    expect(() => source.restoreFromSnapshot(preDeletionSnapshot)).not.toThrow();

    const restored = source.getSnapshot();
    expect(restored.presentationThemes.some((t) => t.id === theme.id)).toBe(true);
    expect(restored.presentations.find((p) => p.id === presentationId)!.themeId).toBe(theme.id);
    expect(foreignKeyViolations(source)).toEqual([]);
  });

  it('restores a snapshot whose overlay/theme container elements are carried through their owner, not slideElements, without duplication', () => {
    // Every element on a theme/overlay/stage container slide is surfaced
    // through that owner's own `elements` field -- never through
    // `snapshot.slideElements`, which is scoped to item-owned slides only
    // (see snapshot-scope.test.ts). Restoring must not duplicate or drop
    // these container elements.
    const overlay = source.createOverlay({
      name: 'Watermark',
      elements: [
        {
          id: 'overlay-el-1',
          slideId: '',
          type: 'text',
          x: 0, y: 0, width: 100, height: 20, rotation: 0, opacity: 1, zIndex: 1, layer: 'content',
          payload: { text: 'CAST', fontFamily: 'Helvetica', fontSize: 24, color: '#FFFFFF', alignment: 'left', weight: '400' },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }).upserts.overlays![0]!;
    source.createItem({ type: 'presentation', title: 'Slides' });
    const snapshot = source.getSnapshot();

    const overlayElementCountBefore = snapshot.overlays.find((o) => o.id === overlay.id)?.elements.length ?? 0;
    expect(overlayElementCountBefore).toBe(1);
    expect(snapshot.slideElements.every((e) => e.slideId !== `${overlay.id}:slide`)).toBe(true);

    expect(() => dest.restoreFromSnapshot(snapshot)).not.toThrow();

    const restored = dest.getSnapshot();
    const restoredOverlay = restored.overlays.find((o) => o.id === overlay.id);
    expect(restoredOverlay).toBeTruthy();
    expect(restoredOverlay!.elements).toHaveLength(overlayElementCountBefore);
    expect(foreignKeyViolations(dest)).toEqual([]);
  });

  it('restores flat playlists/playlistEntries (item rows and separators) with ids preserved', () => {
    const presentationId = source.createItem({ type: 'presentation', title: 'Slides' }).itemId;
    const playlistId = source.createPlaylist('Sunday').upserts.playlists![0]!.id;
    source.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });
    const sepPatch = source.createSeparator(playlistId, 'Opening');
    const sepId = sepPatch.upserts.playlistEntries!.find((row) => row.kind === 'separator')!.id;

    const snapshot = source.getSnapshot();
    const itemRowId = snapshot.playlistEntries.find((row) => row.kind === 'item' && row.reference.itemId === presentationId)!.id;

    expect(() => dest.restoreFromSnapshot(snapshot)).not.toThrow();

    const restored = dest.getSnapshot();
    const restoredSeparator = restored.playlistEntries.find((row) => row.id === sepId);
    const restoredItemRow = restored.playlistEntries.find((row) => row.id === itemRowId);
    expect(restoredSeparator).toBeTruthy();
    expect(restoredSeparator!.kind).toBe('separator');
    expect((restoredSeparator as { label: string }).label).toBe('Opening');
    expect(restoredItemRow).toBeTruthy();
    expect(restoredItemRow!.kind).toBe('item');
    expect(foreignKeyViolations(dest)).toEqual([]);
  });
});
