import { describe, expect, it } from 'vitest';
import type { CastRepository } from './store';
import type { Id, PlaylistTree } from '@core/types';
import { createTestRepository } from './test-support';

// Covers the promoted item from #214: `addDeckItemToGroup` silently returned
// an empty patch for an unresolvable deck item or destination group. Both
// branches now throw, mirroring the `Deck item not found`/`Group not found`
// shapes already used by `moveDeckItemToGroup` (#213) and
// `createDeckItemWithFirstSlide`.
//
// The #214 audit additionally flagged that this method's destination lookup
// (`SELECT id FROM playlist_groups WHERE id = ?`) has no `playlist_id`
// scoping, unlike every sibling that validates a group. That part is *not*
// fixed here: `addDeckItemToGroup(groupId, itemId)` has no playlistId
// parameter to scope against — every live caller
// (`app/renderer/contexts/navigation-context.tsx`,
// `app/renderer/features/library/use-library-panel-management.ts`) has a
// `currentPlaylistId` in scope but never passes it through. Closing that gap
// needs a signature change (an explicit playlistId, mirroring
// `moveDeckItemToGroup`) threading through `app/core/ipc.ts`,
// `app/main/ipc.ts`, `app/main/preload.ts`, and those renderer callers — all
// outside this change's write boundary (and two of those files are owned by
// a concurrent #151 change). The last test below pins today's actual
// behavior — a group from a different playlist is still accepted — as a
// documented, tracked limitation rather than silently asserting it's fixed.

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
      const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');

      expect(() => repo.addDeckItemToGroup(groupId, 'no-such-item'))
        .toThrow(/Deck item not found: no-such-item/);
      expect(entriesFor(repo, 'Service')).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unresolvable destination group id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const talkId = createDeckItem(repo, 'talk', 'Sermon');

      expect(() => repo.addDeckItemToGroup('no-such-group', talkId))
        .toThrow(/Group not found: no-such-group/);
    } finally {
      close();
      cleanup();
    }
  });

  it('adds an item to a valid group without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');

      repo.addDeckItemToGroup(groupId, talkId);

      const entries = entriesFor(repo, 'Service');
      expect(entries).toHaveLength(1);
      expect(entries[0].item.id).toBe(talkId);
    } finally {
      close();
      cleanup();
    }
  });

  // Documents a known, tracked limitation rather than asserting it's fixed:
  // see the file-level comment above. This is NOT the fixed contract — it
  // pins the current (still-accepting) behavior so a future fix that adds
  // playlist scoping changes this test deliberately, not by surprise.
  it('KNOWN LIMITATION (#214): still accepts a destination group belonging to a different playlist', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const { groupId: groupInOtherPlaylist } = createPlaylistWithGroup(repo, libraryId, 'Other Playlist', 'Closing');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');

      expect(() => repo.addDeckItemToGroup(groupInOtherPlaylist, talkId)).not.toThrow();

      const otherEntries = entriesFor(repo, 'Other Playlist');
      expect(otherEntries).toHaveLength(1);
      expect(otherEntries[0].item.id).toBe(talkId);
    } finally {
      close();
      cleanup();
    }
  });
});
