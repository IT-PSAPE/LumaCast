import { describe, expect, it, vi } from 'vitest';
import type { CastRepository } from './store';
import type { Id } from '@lumacast/kernel';
import type { PlaylistTree } from '@lumacast/composition';
import { createTestRepository } from './test-support';

// Covers issue #213: moveDeckItemToGroup used to delete the item's playlist
// entries before validating the destination group, and reported success even
// when the destination didn't resolve — silently orphaning the item from
// every group. These tests pin the fixed contract: validate first, mutate
// atomically, and let an unresolvable item or destination raise loudly.

function createLibrary(repo: CastRepository, name: string): Id {
  const patch = repo.createLibrary(name);
  const library = patch.upserts.libraries?.[0];
  if (!library) throw new Error('createLibrary returned no library');
  return library.id;
}

function createDeckItem(repo: CastRepository, type: 'presentation' | 'lyric' | 'talk', title: string): Id {
  const patch = repo.createDeckItemWithTheme({ type, title });
  const key = type === 'presentation' ? 'presentations' : type === 'lyric' ? 'lyrics' : 'talks';
  const item = patch.upserts[key]?.[0];
  if (!item) throw new Error(`createDeckItemWithTheme returned no ${key} item`);
  return item.id;
}

function findPlaylistTree(repo: CastRepository, playlistName: string): PlaylistTree {
  for (const bundle of repo.getSnapshot().libraryBundles) {
    const tree = bundle.playlists.find((t) => t.playlist.name === playlistName);
    if (tree) return tree;
  }
  throw new Error(`playlist not found: ${playlistName}`);
}

function entriesFor(repo: CastRepository, playlistName: string) {
  return findPlaylistTree(repo, playlistName).groups.flatMap((g) => g.entries);
}

function createPlaylistWithGroup(
  repo: CastRepository,
  libraryId: Id,
  playlistName: string,
  groupName: string,
): { playlistId: Id; groupId: Id } {
  repo.createPlaylist(libraryId, playlistName);
  const tree = findPlaylistTree(repo, playlistName);
  repo.createPlaylistGroup(tree.playlist.id, groupName);
  const updated = findPlaylistTree(repo, playlistName);
  const group = updated.groups.find((g) => g.group.name === groupName);
  if (!group) throw new Error(`group not found: ${groupName}`);
  return { playlistId: tree.playlist.id, groupId: group.group.id };
}

// Forces the Nth db.prepare() call whose SQL contains `match` to throw,
// simulating a failure partway through an atomic transaction so we can
// assert complete rollback. Mirrors the helper in theme-background.test.ts.
function failOnPrepare(repo: CastRepository, match: string, occurrence = 1): () => void {
  const db = (repo as unknown as { db: { prepare: (sql: string) => unknown } }).db;
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

describe('CastRepository.moveDeckItemToGroup (#213)', () => {
  it('throws for a nonexistent destination group and leaves the item in its original group', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupId, talkId);

      expect(() => repo.moveDeckItemToGroup(playlistId, talkId, 'no-such-group')).toThrow(/Group not found: no-such-group/);

      const entries = entriesFor(repo, 'Service');
      expect(entries).toHaveLength(1);
      expect(entries[0].entry.groupId).toBe(groupId);
      expect(entries[0].item.id).toBe(talkId);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws when the destination group belongs to a different playlist and leaves the item in its original group', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId: playlistAId, groupId: groupA } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const { groupId: groupInOtherPlaylist } = createPlaylistWithGroup(repo, libraryId, 'Other Playlist', 'Closing');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistAId, groupA, talkId);

      expect(() => repo.moveDeckItemToGroup(playlistAId, talkId, groupInOtherPlaylist))
        .toThrow(new RegExp(`Group not found: ${groupInOtherPlaylist}`));

      const entries = entriesFor(repo, 'Service');
      expect(entries).toHaveLength(1);
      expect(entries[0].entry.groupId).toBe(groupA);
      expect(entries[0].item.id).toBe(talkId);

      // The other playlist's group was never touched either.
      const otherEntries = entriesFor(repo, 'Other Playlist');
      expect(otherEntries).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unresolvable deck item id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');

      expect(() => repo.moveDeckItemToGroup(playlistId, 'no-such-item', groupId)).toThrow(/Deck item not found: no-such-item/);
    } finally {
      close();
      cleanup();
    }
  });

  it('moves an item to a valid destination group, landing after the current maximum order index', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId: groupA } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      repo.createPlaylistGroup(playlistId, 'Closing');
      const groupB = findPlaylistTree(repo, 'Service').groups.find((g) => g.group.name === 'Closing')!.group.id;

      // Seed groupB with two existing entries so its current max order index is 1.
      const existingA = createDeckItem(repo, 'presentation', 'Existing A');
      const existingB = createDeckItem(repo, 'lyric', 'Existing B');
      repo.addDeckItemToGroup(playlistId, groupB, existingA);
      repo.addDeckItemToGroup(playlistId, groupB, existingB);

      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupA, talkId);

      repo.moveDeckItemToGroup(playlistId, talkId, groupB);

      const entries = entriesFor(repo, 'Service');
      // Gone from groupA, present exactly once overall.
      expect(entries.filter((e) => e.item.id === talkId)).toHaveLength(1);
      const movedEntry = entries.find((e) => e.item.id === talkId)!;
      expect(movedEntry.entry.groupId).toBe(groupB);

      const groupBEntries = findPlaylistTree(repo, 'Service').groups.find((g) => g.group.id === groupB)!.entries;
      // Ordered by order_index ASC — the moved item lands after the two seeded entries.
      expect(groupBEntries.map((e) => e.item.id)).toEqual([existingA, existingB, talkId]);
    } finally {
      close();
      cleanup();
    }
  });

  it('unassigns the item from every group in the playlist when groupId is null, without error', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupId, talkId);
      expect(entriesFor(repo, 'Service')).toHaveLength(1);

      expect(() => repo.moveDeckItemToGroup(playlistId, talkId, null)).not.toThrow();

      expect(entriesFor(repo, 'Service')).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('is atomic: a failure between the delete and the insert leaves the original entry intact', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId: groupA } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      repo.createPlaylistGroup(playlistId, 'Closing');
      const groupB = findPlaylistTree(repo, 'Service').groups.find((g) => g.group.name === 'Closing')!.group.id;

      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupA, talkId);

      const restore = failOnPrepare(repo, 'INSERT INTO playlist_entries');
      try {
        expect(() => repo.moveDeckItemToGroup(playlistId, talkId, groupB)).toThrow(/forced failure/);
      } finally {
        restore();
      }

      // Rolled back completely: the item is observable in its original group,
      // never in neither group nor both.
      const entries = entriesFor(repo, 'Service');
      expect(entries).toHaveLength(1);
      expect(entries[0].entry.groupId).toBe(groupA);
      expect(entries[0].item.id).toBe(talkId);
    } finally {
      close();
      cleanup();
    }
  });
});
