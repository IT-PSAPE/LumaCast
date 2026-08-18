// Regression coverage for #208: `restoreFromSnapshot` never touched the
// eight `*_collections` tables, so restoring a snapshot into any database
// other than the one that produced it threw `FOREIGN KEY constraint failed`
// on the first row referencing a bin default (each repository self-seeds its
// bin defaults with a random `createId()`). See the fix in `store.ts`
// (`restoreFromSnapshot`, `assertSnapshotCollectionDefaults`).
//
// Two adjacent, pre-existing bugs in the same function were masked by the
// collection defect above (it always threw first, before either could be
// reached) and are fixed alongside it here:
//   1. `insertSlide`'s VALUES clause had 15 placeholders for 16 columns.
//   2. The generic slide-element restore loop iterated `snapshot.slideElements`
//      unfiltered. That array (from `getSlideElements()`) is not scoped to
//      deck content slides the way `snapshot.slides` is -- it also carries
//      every theme/overlay/stage container's elements (every fresh
//      repository self-seeds a default overlay with a branding element, so
//      this fires on effectively every real database). Those elements are
//      already restored via `replaceContainerElements` in the theme/overlay/
//      stage loops, so re-inserting them from the generic loop either hit
//      the `slide_id` foreign key (their container slide did not exist yet)
//      or would have collided on primary key (once it did).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Id } from '@lumacast/kernel';
import type { CollectionBinKind } from '@lumacast/composition';
import { CastRepository } from './store';

const COLLECTION_TABLE_BY_BIN: Record<CollectionBinKind, string> = {
  deck: 'deck_collections',
  image: 'image_collections',
  video: 'video_collections',
  audio: 'audio_collections',
  theme: 'theme_collections',
  overlay: 'overlay_collections',
  stage: 'stage_collections',
  macro: 'macro_collections',
};

type RawDb = {
  prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown };
  close(): void;
};

function rawDb(target: CastRepository): RawDb {
  return (target as unknown as { db: RawDb }).db;
}

function makeRepo(dir: string): CastRepository {
  return new CastRepository({ dbPath: path.join(dir, 'lumacast.sqlite'), userDataPath: dir, documentsPath: dir });
}

function closeRepo(target: CastRepository): void {
  rawDb(target).close();
}

function createLibrary(target: CastRepository, name: string): Id {
  const patch = target.createLibrary(name);
  const library = patch.upserts.libraries?.[0];
  if (!library) throw new Error('createLibrary returned no library');
  return library.id;
}

function createDeckItem(target: CastRepository, type: 'presentation' | 'lyric' | 'talk', title: string): Id {
  const patch = target.createDeckItemWithTheme({ type, title });
  const key = type === 'presentation' ? 'presentations' : type === 'lyric' ? 'lyrics' : 'talks';
  const item = patch.upserts[key]?.[0];
  if (!item) throw new Error(`createDeckItemWithTheme returned no ${key} item`);
  return item.id;
}

function defaultCollectionCounts(target: CastRepository): Record<CollectionBinKind, number> {
  const db = rawDb(target);
  const out = {} as Record<CollectionBinKind, number>;
  for (const [bin, table] of Object.entries(COLLECTION_TABLE_BY_BIN) as Array<[CollectionBinKind, string]>) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE is_default = 1`).get() as { count: number };
    out[bin] = row.count;
  }
  return out;
}

function foreignKeyViolations(target: CastRepository): unknown[] {
  return rawDb(target).prepare('PRAGMA foreign_key_check').all();
}

function findPresentationCollectionId(target: CastRepository, presentationId: Id): string | null {
  const row = rawDb(target)
    .prepare('SELECT collection_id FROM presentations WHERE id = ?')
    .get(presentationId) as { collection_id: string | null } | undefined;
  return row?.collection_id ?? null;
}

describe('restoreFromSnapshot collection restore (#208)', () => {
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

  it('restores cleanly into a different, independently seeded repository (verified reproduction)', () => {
    const libraryId = createLibrary(source, 'Library');
    const presentationId = createDeckItem(source, 'presentation', 'Slides');
    const snapshot = source.getSnapshot();

    // Sanity check on the reproduction: the two repositories self-seeded
    // different random ids for the deck bin's default collection.
    const sourceDeckDefault = snapshot.collections.find((c) => c.binKind === 'deck' && c.isDefault);
    const destDeckDefaultBefore = dest.getSnapshot().collections.find((c) => c.binKind === 'deck' && c.isDefault);
    expect(sourceDeckDefault).toBeTruthy();
    expect(destDeckDefaultBefore).toBeTruthy();
    expect(sourceDeckDefault!.id).not.toBe(destDeckDefaultBefore!.id);

    expect(() => dest.restoreFromSnapshot(snapshot)).not.toThrow();

    const restored = dest.getSnapshot();
    expect(restored.libraries.map((l) => l.id)).toContain(libraryId);
    expect(restored.presentations.map((p) => p.id)).toContain(presentationId);
    expect(findPresentationCollectionId(dest, presentationId)).toBe(sourceDeckDefault!.id);
  });

  it('reproduces the snapshot source collection ids, names, order and is_default flags exactly', () => {
    createLibrary(source, 'Library');
    source.createCollection({ binKind: 'deck', name: 'Sermons' });
    const snapshot = source.getSnapshot();

    dest.restoreFromSnapshot(snapshot);

    const restoredCollections = dest.getSnapshot().collections;
    // Same set of ids, and every field on every collection matches exactly
    // (order-independent compare since collection ordering across bins can
    // legitimately differ in array position while still matching per-bin).
    const byId = new Map(restoredCollections.map((c) => [c.id, c]));
    expect(restoredCollections).toHaveLength(snapshot.collections.length);
    for (const expected of snapshot.collections) {
      const actual = byId.get(expected.id);
      expect(actual).toBeTruthy();
      expect(actual).toEqual(expected);
    }
  });

  it('leaves PRAGMA foreign_key_check clean after a cross-repository restore', () => {
    createLibrary(source, 'Library');
    createDeckItem(source, 'presentation', 'Slides');
    createDeckItem(source, 'talk', 'Sermon');
    source.createCollection({ binKind: 'image', name: 'Backgrounds' });
    const snapshot = source.getSnapshot();

    dest.restoreFromSnapshot(snapshot);

    expect(foreignKeyViolations(dest)).toEqual([]);
  });

  it('leaves exactly one default collection per bin after a restore, never two or zero', () => {
    createLibrary(source, 'Library');
    createDeckItem(source, 'presentation', 'Slides');
    const snapshot = source.getSnapshot();

    dest.restoreFromSnapshot(snapshot);

    const counts = defaultCollectionCounts(dest);
    for (const bin of Object.keys(COLLECTION_TABLE_BY_BIN) as CollectionBinKind[]) {
      expect(counts[bin]).toBe(1);
    }
  });

  it('rejects a snapshot missing a bin default before touching any table', () => {
    createLibrary(source, 'Library');
    const snapshot = source.getSnapshot();
    const corrupted = {
      ...snapshot,
      collections: snapshot.collections.filter((c) => !(c.binKind === 'deck' && c.isDefault)),
    };

    const before = dest.getSnapshot();
    expect(() => dest.restoreFromSnapshot(corrupted)).toThrow(/exactly one default collection/);
    // Fails fast: destination is untouched by the rejected restore.
    expect(dest.getSnapshot()).toEqual(before);
  });

  it('same-database undo/redo round trips a snapshot back into the repository that produced it', () => {
    const libraryId = createLibrary(source, 'Library');
    const presentationId = createDeckItem(source, 'presentation', 'Slides');
    const snapshot = source.getSnapshot();

    // Mutate after the snapshot was captured, then "undo" back to it.
    createDeckItem(source, 'talk', 'Sermon added after snapshot');
    source.createCollection({ binKind: 'deck', name: 'Extra' });

    expect(() => source.restoreFromSnapshot(snapshot)).not.toThrow();

    const restored = source.getSnapshot();
    // Restore reverts to exactly the pre-mutation snapshot: same library and
    // presentation ids as captured, the post-snapshot Talk gone, and every
    // bin's collection set back to what the snapshot held (not what the
    // post-snapshot mutation left, e.g. the extra "Extra" deck collection).
    expect(restored.libraries.map((l) => l.id).sort()).toEqual(snapshot.libraries.map((l) => l.id).sort());
    expect(restored.libraries.map((l) => l.id)).toContain(libraryId);
    expect(restored.presentations.map((p) => p.id)).toEqual(snapshot.presentations.map((p) => p.id));
    expect(restored.presentations.map((p) => p.id)).toContain(presentationId);
    expect(restored.talks).toHaveLength(0);
    expect(restored.collections.filter((c) => c.binKind === 'deck').map((c) => c.id).sort()).toEqual(
      snapshot.collections.filter((c) => c.binKind === 'deck').map((c) => c.id).sort(),
    );
    expect(foreignKeyViolations(source)).toEqual([]);
  });

  // Open question from the issue: can undo across a collection deletion --
  // where items were reassigned to a bin default and the snapshot predates
  // that deletion -- hit the FK failure on the SAME database? Answer: yes,
  // it was reachable pre-fix. `deleteCollection` performs a real SQL DELETE
  // on the collection row (store.ts, `deleteCollection`), so a pre-deletion
  // snapshot's items still reference a collection id that no longer exists
  // anywhere in the live database once the collection is deleted -- there is
  // no self-seeded fallback row wearing that id the way there is for a fresh
  // database's bin defaults. The old `restoreFromSnapshot` never re-created
  // collection rows at all, so restoring that snapshot would have hit the
  // exact same `FOREIGN KEY constraint failed` on the first item row
  // referencing the deleted collection. The fix resolves this too, because
  // collections are now restored wholesale from the snapshot, including the
  // since-deleted one.
  it('restores cleanly across a same-database collection deletion (snapshot predates the delete)', () => {
    const libraryId = createLibrary(source, 'Library');
    const customCollection = source.createCollection({ binKind: 'deck', name: 'Sermons' }).upserts.collections?.[0];
    if (!customCollection) throw new Error('createCollection returned no collection');
    const presentationId = createDeckItem(source, 'presentation', 'Slides');
    source.setItemCollection({ itemType: 'presentation', itemId: presentationId, collectionId: customCollection.id });

    const preDeletionSnapshot = source.getSnapshot();
    expect(findPresentationCollectionId(source, presentationId)).toBe(customCollection.id);

    // Delete the custom collection: the item is reassigned to the bin
    // default and the collection row is really gone (not just re-seeded
    // under a new random id).
    source.deleteCollection({ binKind: 'deck', id: customCollection.id });
    const deckCollectionIdsAfterDelete = source.getSnapshot().collections
      .filter((c) => c.binKind === 'deck')
      .map((c) => c.id);
    expect(deckCollectionIdsAfterDelete).not.toContain(customCollection.id);

    // Undo: restore the snapshot captured before the deletion, on the same
    // repository/database that produced it.
    expect(() => source.restoreFromSnapshot(preDeletionSnapshot)).not.toThrow();

    const restored = source.getSnapshot();
    expect(restored.libraries.map((l) => l.id)).toContain(libraryId);
    expect(restored.collections.some((c) => c.id === customCollection.id && c.binKind === 'deck')).toBe(true);
    expect(findPresentationCollectionId(source, presentationId)).toBe(customCollection.id);
    expect(foreignKeyViolations(source)).toEqual([]);
  });

  it('restores a snapshot whose overlay/theme elements are carried in snapshot.slideElements without error or duplication (adjacent bug)', () => {
    // Every fresh repository self-seeds a default overlay with its own
    // branding element; `getSnapshot().slideElements` includes that
    // container-owned element alongside genuine deck content elements.
    const overlayId = source.getSnapshot().overlays[0]?.id;
    expect(overlayId).toBeTruthy();
    createLibrary(source, 'Library');
    createDeckItem(source, 'presentation', 'Slides');
    const snapshot = source.getSnapshot();

    const overlayElementCountBefore = snapshot.overlays.find((o) => o.id === overlayId)?.elements.length ?? 0;
    expect(overlayElementCountBefore).toBeGreaterThan(0);
    expect(snapshot.slideElements.some((e) => e.slideId !== undefined)).toBe(true);

    expect(() => dest.restoreFromSnapshot(snapshot)).not.toThrow();

    const restored = dest.getSnapshot();
    const restoredOverlay = restored.overlays.find((o) => o.id === overlayId);
    expect(restoredOverlay).toBeTruthy();
    // Not duplicated: the overlay's element count matches the source exactly.
    expect(restoredOverlay!.elements).toHaveLength(overlayElementCountBefore);
    expect(foreignKeyViolations(dest)).toEqual([]);
  });
});
