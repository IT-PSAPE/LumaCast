import { describe, expect, it } from 'vitest';
import type { CastRepository } from './store';
import type { Id } from '@lumacast/kernel';
import type { ItemType, PlaylistItemEntry, PlaylistRow } from '@lumacast/composition';
import { createTestRepository } from './test-support';

// #219 item-model refactor (decision D5): playlist groups are gone. A
// playlist is a flat, ordered list of rows; attaching an EXISTING item to a
// playlist is `addItemToPlaylist(playlistId, itemRef, position?)` — the
// successor to `addDeckItemToGroup`. This file covers that method's
// existence guards, its append-at-end default, and its positioned-insert
// behavior, plus the kind-discrimination invariant: every row it produces is
// `kind: 'item'` with a `reference` that only ever resolved via a `kind`
// check, never a nullable-owner-column guess.

function createItem(repo: CastRepository, type: ItemType, title: string): Id {
  const { itemId } = repo.createItem({ type, title });
  return itemId;
}

function createPlaylist(repo: CastRepository, name: string): Id {
  const patch = repo.createPlaylist(name);
  const playlist = patch.upserts.playlists?.[0];
  if (!playlist) throw new Error('createPlaylist returned no playlist');
  return playlist.id;
}

function rowsFor(repo: CastRepository, playlistId: Id): PlaylistRow[] {
  return repo
    .getSnapshot()
    .playlistEntries.filter((row) => row.playlistId === playlistId)
    .slice()
    .sort((a, b) => a.order - b.order);
}

function itemEntries(repo: CastRepository, playlistId: Id): PlaylistItemEntry[] {
  return rowsFor(repo, playlistId).filter((row): row is PlaylistItemEntry => row.kind === 'item');
}

describe('CastRepository.addItemToPlaylist', () => {
  it('throws for an unresolvable playlist id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const talkId = createItem(repo, 'talk', 'Sermon');
      expect(() => repo.addItemToPlaylist('no-such-playlist', { type: 'talk', id: talkId }))
        .toThrow(/Playlist not found: no-such-playlist/);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unresolvable item id and inserts nothing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      expect(() => repo.addItemToPlaylist(playlistId, { type: 'talk', id: 'no-such-item' }))
        .toThrow(/Item not found: talk no-such-item/);
      expect(itemEntries(repo, playlistId)).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws when the ItemRef type does not match the id\'s actual table', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const presentationId = createItem(repo, 'presentation', 'Slides');

      // A real id, but claimed under the wrong type — resolveItemOwnerRow
      // must reject the type mismatch rather than resolving by id alone.
      expect(() => repo.addItemToPlaylist(playlistId, { type: 'lyric', id: presentationId }))
        .toThrow(new RegExp(`Item not found: lyric ${presentationId}`));
      expect(itemEntries(repo, playlistId)).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('adds each item type with a correct, kind-discriminated reference', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const presentationId = createItem(repo, 'presentation', 'Slides');
      const lyricId = createItem(repo, 'lyric', 'Song');
      const talkId = createItem(repo, 'talk', 'Sermon');

      repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });
      repo.addItemToPlaylist(playlistId, { type: 'lyric', id: lyricId });
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: talkId });

      const entries = itemEntries(repo, playlistId);
      expect(entries).toHaveLength(3);

      const talkEntry = entries.find((e) => e.reference.itemId === talkId)!;
      expect(talkEntry.kind).toBe('item');
      expect(talkEntry.reference).toEqual({ type: 'talk', itemId: talkId });
      expect(talkEntry.talkId).toBe(talkId);
      expect(talkEntry.presentationId).toBeNull();
      expect(talkEntry.lyricId).toBeNull();

      const presentationEntry = entries.find((e) => e.reference.itemId === presentationId)!;
      expect(presentationEntry.reference).toEqual({ type: 'presentation', itemId: presentationId });

      const lyricEntry = entries.find((e) => e.reference.itemId === lyricId)!;
      expect(lyricEntry.reference).toEqual({ type: 'lyric', itemId: lyricId });
    } finally {
      close();
      cleanup();
    }
  });

  it('appends at the end (max order_index + 1) when position is omitted', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const existingA = createItem(repo, 'presentation', 'Existing A');
      const existingB = createItem(repo, 'lyric', 'Existing B');
      repo.addItemToPlaylist(playlistId, { type: 'presentation', id: existingA });
      repo.addItemToPlaylist(playlistId, { type: 'lyric', id: existingB });

      const talkId = createItem(repo, 'talk', 'Sermon');
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: talkId });

      const entries = itemEntries(repo, playlistId);
      expect(entries.map((e) => e.reference.itemId)).toEqual([existingA, existingB, talkId]);
      // Dense, gapless order — not just insertion-order tie-breaking.
      expect(entries.map((e) => e.order)).toEqual([0, 1, 2]);
    } finally {
      close();
      cleanup();
    }
  });

  it('inserts at an explicit position, shifting later rows down', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const firstId = createItem(repo, 'talk', 'First');
      const secondId = createItem(repo, 'talk', 'Second');
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: firstId });
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: secondId });

      const insertedId = createItem(repo, 'talk', 'Inserted');
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: insertedId }, 1);

      const entries = itemEntries(repo, playlistId);
      expect(entries.map((e) => e.reference.itemId)).toEqual([firstId, insertedId, secondId]);
      expect(entries.map((e) => e.order)).toEqual([0, 1, 2]);
    } finally {
      close();
      cleanup();
    }
  });

  it('inserting at position 0 places the new row before every existing row', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const firstId = createItem(repo, 'talk', 'First');
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: firstId });

      const insertedId = createItem(repo, 'talk', 'Inserted');
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: insertedId }, 0);

      const entries = itemEntries(repo, playlistId);
      expect(entries.map((e) => e.reference.itemId)).toEqual([insertedId, firstId]);
    } finally {
      close();
      cleanup();
    }
  });

  it('allows the same item to be attached to a playlist twice, each row keeping its own identity', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const talkId = createItem(repo, 'talk', 'Sermon');

      repo.addItemToPlaylist(playlistId, { type: 'talk', id: talkId });
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: talkId });

      const entries = itemEntries(repo, playlistId);
      expect(entries).toHaveLength(2);
      expect(entries[0].id).not.toBe(entries[1].id);
      expect(entries.every((e) => e.reference.itemId === talkId)).toBe(true);
    } finally {
      close();
      cleanup();
    }
  });

  it('attaches the same item to two different playlists independently', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistAId = createPlaylist(repo, 'Service A');
      const playlistBId = createPlaylist(repo, 'Service B');
      const talkId = createItem(repo, 'talk', 'Sermon');

      repo.addItemToPlaylist(playlistAId, { type: 'talk', id: talkId });
      repo.addItemToPlaylist(playlistBId, { type: 'talk', id: talkId });

      expect(itemEntries(repo, playlistAId)).toHaveLength(1);
      expect(itemEntries(repo, playlistBId)).toHaveLength(1);
      expect(itemEntries(repo, playlistAId)[0].id).not.toBe(itemEntries(repo, playlistBId)[0].id);
    } finally {
      close();
      cleanup();
    }
  });

  it('returns a patch whose upserted playlistEntries reflect the whole playlist, with no libraryBundles/replace keys', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const talkId = createItem(repo, 'talk', 'Sermon');

      const patch = repo.addItemToPlaylist(playlistId, { type: 'talk', id: talkId });

      expect(patch.upserts.playlistEntries).toBeDefined();
      expect(patch.upserts.playlistEntries!.length).toBeGreaterThan(0);
      expect(Object.prototype.hasOwnProperty.call(patch.upserts, 'libraryBundles')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(patch, 'replace')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(patch.deletes, 'libraryBundles')).toBe(false);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.createItem with playlistId/position (successor to createDeckItemWithTheme + addDeckItemToGroup)', () => {
  it('creates a brand-new item already placed in the playlist at the given position', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const firstId = createItem(repo, 'talk', 'First');
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: firstId });

      const { itemId, patch } = repo.createItem({ type: 'lyric', title: 'New Song', playlistId, position: 0 });

      const entries = itemEntries(repo, playlistId);
      expect(entries.map((e) => e.reference.itemId)).toEqual([itemId, firstId]);
      expect(patch.upserts.lyrics?.[0]?.id).toBe(itemId);
      expect(patch.upserts.playlistEntries).toBeDefined();
    } finally {
      close();
      cleanup();
    }
  });

  it('creates a new item with no playlistId and leaves every playlist untouched', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const { patch } = repo.createItem({ type: 'presentation', title: 'Standalone' });

      expect(itemEntries(repo, playlistId)).toHaveLength(0);
      expect(patch.upserts.playlistEntries).toBeUndefined();
    } finally {
      close();
      cleanup();
    }
  });
});
