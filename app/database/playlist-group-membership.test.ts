import { describe, expect, it } from 'vitest';
import type { CastRepository } from './store';
import type { Id } from '@lumacast/kernel';
import type { PlaylistTree } from '@lumacast/composition';
import { createTestRepository } from './test-support';

// Covers the promoted item from #214: `addDeckItemToGroup` silently returned
// an empty patch for an unresolvable deck item or destination group. Both
// branches now throw, mirroring the `Deck item not found`/`Group not found`
// shapes already used by `moveDeckItemToGroup` (#213) and
// `createDeckItemWithFirstSlide`.
//
// The #214 audit additionally flagged that this method's destination lookup
// (`SELECT id FROM playlist_groups WHERE id = ?`) had no `playlist_id`
// scoping, unlike every sibling that validates a group. That gap is fixed
// here (#220): `addDeckItemToGroup(playlistId, groupId, itemId)` now scopes
// the group lookup on both columns, so a group belonging to a different
// playlist is rejected with `Group not found` and nothing is inserted — the
// same contract `moveDeckItemToGroup` already had.

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

describe('CastRepository.addDeckItemToGroup (#214)', () => {
  it('throws for an unresolvable deck item id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');

      expect(() => repo.addDeckItemToGroup(playlistId, groupId, 'no-such-item'))
        .toThrow(/Deck item not found: no-such-item/);
      expect(entriesFor(repo, 'Service')).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });

  // Uses a REAL owning playlist with a bogus group id, so the assertion
  // isolates the group-missing branch. Passing two bogus ids would also pass
  // against an implementation that scoped on `playlist_id` alone.
  it('throws for an unresolvable destination group id within a real playlist', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');

      expect(() => repo.addDeckItemToGroup(playlistId, 'no-such-group', talkId))
        .toThrow(/Group not found: no-such-group/);
      expect(entriesFor(repo, 'Service')).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('adds an item to a valid group without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');

      repo.addDeckItemToGroup(playlistId, groupId, talkId);

      const entries = entriesFor(repo, 'Service');
      expect(entries).toHaveLength(1);
      expect(entries[0].item.id).toBe(talkId);
    } finally {
      close();
      cleanup();
    }
  });

  it('appends a valid add at max order_index + 1', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const existingA = createDeckItem(repo, 'presentation', 'Existing A');
      const existingB = createDeckItem(repo, 'lyric', 'Existing B');
      repo.addDeckItemToGroup(playlistId, groupId, existingA);
      repo.addDeckItemToGroup(playlistId, groupId, existingB);

      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupId, talkId);

      const groupEntries = findPlaylistTree(repo, 'Service').groups.find((g) => g.group.id === groupId)!.entries;
      // Ordered by order_index ASC — the added item lands after the two seeded entries.
      expect(groupEntries.map((e) => e.item.id)).toEqual([existingA, existingB, talkId]);
      // Assert the indices themselves, not just the sequence: the tree builder
      // sorts by order_index ASC with no secondary key, so a regression that
      // inserted every entry at a constant index would still yield the order
      // above via insertion-order tie-breaking.
      expect(groupEntries.map((e) => e.entry.order)).toEqual([0, 1, 2]);
    } finally {
      close();
      cleanup();
    }
  });

  it('rejects a destination group belonging to a different playlist and inserts nothing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const { groupId: groupInOtherPlaylist } = createPlaylistWithGroup(repo, libraryId, 'Other Playlist', 'Closing');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');

      expect(() => repo.addDeckItemToGroup(playlistId, groupInOtherPlaylist, talkId))
        .toThrow(new RegExp(`Group not found: ${groupInOtherPlaylist}`));

      // Neither the intended playlist nor the other playlist was touched.
      expect(entriesFor(repo, 'Service')).toHaveLength(0);
      expect(entriesFor(repo, 'Other Playlist')).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });
});
