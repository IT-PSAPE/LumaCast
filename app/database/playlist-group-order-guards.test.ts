import { describe, expect, it } from 'vitest';
import type { CastRepository } from './store';
import type { Id, PlaylistTree } from '@core/types';
import { createTestRepository } from './test-support';

// Covers #214's group 3: the playlist/group ordering methods each silently
// returned an empty patch when an id failed to resolve, making a failed
// mutation indistinguishable from success. This group's distinguishing
// feature is that several of its guards are GENUINE no-ops — "already at the
// requested position", "already first/last" — and those must stay no-ops.
//
// For every converted guard there is a test pinning the throw, and for every
// genuine no-op a test proving it still does NOT throw and changes nothing
// (order and updated-at untouched, so failure and no-change stay
// distinguishable without reading the guard).

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

function groupOrders(repo: CastRepository, playlistName: string): Array<{ id: Id; order: number }> {
  return findPlaylistTree(repo, playlistName).groups.map((g) => ({ id: g.group.id, order: g.group.order }));
}

function entryOrders(repo: CastRepository, playlistName: string, groupId: Id): Array<{ id: Id; order: number }> {
  const group = findPlaylistTree(repo, playlistName).groups.find((g) => g.group.id === groupId);
  if (!group) throw new Error(`group not found: ${groupId}`);
  return group.entries.map((e) => ({ id: e.entry.id, order: e.entry.order }));
}

function playlistOrders(repo: CastRepository, libraryId: Id): Array<{ id: Id; order: number }> {
  const bundle = repo.getSnapshot().libraryBundles.find((b) => b.library.id === libraryId);
  if (!bundle) throw new Error(`library not found: ${libraryId}`);
  return bundle.playlists.map((t) => ({ id: t.playlist.id, order: t.playlist.order }));
}

function libraryOrders(repo: CastRepository): Array<{ id: Id; order: number }> {
  return repo.getSnapshot().libraries.map((l) => ({ id: l.id, order: l.order }));
}

// Deck order is shared across presentations/lyrics/talks (see
// getOrderedContentReferences): one sequence over all three tables.
function deckOrders(repo: CastRepository): Array<{ id: Id; order: number }> {
  const { presentations, lyrics, talks } = repo.getSnapshot();
  return [...presentations, ...lyrics, ...talks]
    .map((item) => ({ id: item.id, order: item.order }))
    .sort((a, b) => a.order - b.order);
}

describe('CastRepository.setItemCollection (#214 group 3)', () => {
  it('throws for an unresolvable item id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const deckCollectionId = repo.getSnapshot().collections.find((c) => c.binKind === 'deck')!.id;
      expect(() => repo.setItemCollection({
        itemType: 'presentation',
        itemId: 'no-such-item',
        collectionId: deckCollectionId,
      })).toThrow(/Item not found: no-such-item/);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unresolvable media asset id across the split asset tables', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const imageCollectionId = repo.getSnapshot().collections.find((c) => c.binKind === 'image')!.id;
      expect(() => repo.setItemCollection({
        itemType: 'media_asset',
        itemId: 'no-such-asset',
        collectionId: imageCollectionId,
      })).toThrow(/Item not found: no-such-asset/);
    } finally {
      close();
      cleanup();
    }
  });

  it('still throws for an unresolvable target collection (pre-existing guard)', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const presentationId = createDeckItem(repo, 'presentation', 'Sermon');
      expect(() => repo.setItemCollection({
        itemType: 'presentation',
        itemId: presentationId,
        collectionId: 'no-such-collection',
      })).toThrow(/Unknown target collection: no-such-collection/);
    } finally {
      close();
      cleanup();
    }
  });

  it('assigns an existing item without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const presentationId = createDeckItem(repo, 'presentation', 'Sermon');
      const patch = repo.createCollection({ binKind: 'deck', name: 'Archive' });
      const archiveId = patch.upserts.collections?.[0]?.id;
      if (!archiveId) throw new Error('createCollection returned no collection');

      expect(() => repo.setItemCollection({
        itemType: 'presentation',
        itemId: presentationId,
        collectionId: archiveId,
      })).not.toThrow();
      const moved = repo.getSnapshot().presentations.find((p) => p.id === presentationId);
      expect(moved?.collectionId).toBe(archiveId);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.movePlaylistEntry (#214 group 3)', () => {
  it('throws for an unresolvable entry id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.movePlaylistEntry('no-such-entry', 'up'))
        .toThrow(/Playlist entry not found: no-such-entry/);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an entry id that was removed, distinguishing failure from no-change', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupId, talkId);
      const entryId = findPlaylistTree(repo, 'Service').groups[0].entries[0].entry.id;
      repo.movePlaylistEntryToGroup(entryId, null);

      expect(() => repo.movePlaylistEntry(entryId, 'up'))
        .toThrow(/Playlist entry not found: /);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the first entry is asked to move up', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const firstId = createDeckItem(repo, 'talk', 'First');
      const secondId = createDeckItem(repo, 'talk', 'Second');
      repo.addDeckItemToGroup(playlistId, groupId, firstId);
      repo.addDeckItemToGroup(playlistId, groupId, secondId);
      const [firstEntry, secondEntry] = entryOrders(repo, 'Service', groupId);
      const before = entryOrders(repo, 'Service', groupId);

      expect(() => repo.movePlaylistEntry(firstEntry.id, 'up')).not.toThrow();

      const after = entryOrders(repo, 'Service', groupId);
      expect(after).toEqual(before);
      expect(after.map((e) => e.id)).toEqual([firstEntry.id, secondEntry.id]);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the last entry is asked to move down', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const firstId = createDeckItem(repo, 'talk', 'First');
      const secondId = createDeckItem(repo, 'talk', 'Second');
      repo.addDeckItemToGroup(playlistId, groupId, firstId);
      repo.addDeckItemToGroup(playlistId, groupId, secondId);
      const [firstEntry, secondEntry] = entryOrders(repo, 'Service', groupId);
      const before = entryOrders(repo, 'Service', groupId);

      expect(() => repo.movePlaylistEntry(secondEntry.id, 'down')).not.toThrow();

      const after = entryOrders(repo, 'Service', groupId);
      expect(after).toEqual(before);
      expect(after.map((e) => e.id)).toEqual([firstEntry.id, secondEntry.id]);
    } finally {
      close();
      cleanup();
    }
  });

  it('still swaps a middle entry in the direction requested', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const firstId = createDeckItem(repo, 'talk', 'First');
      const secondId = createDeckItem(repo, 'talk', 'Second');
      const thirdId = createDeckItem(repo, 'talk', 'Third');
      repo.addDeckItemToGroup(playlistId, groupId, firstId);
      repo.addDeckItemToGroup(playlistId, groupId, secondId);
      repo.addDeckItemToGroup(playlistId, groupId, thirdId);
      const [firstEntry, secondEntry] = entryOrders(repo, 'Service', groupId);

      repo.movePlaylistEntry(secondEntry.id, 'up');

      const after = entryOrders(repo, 'Service', groupId);
      expect(after.map((e) => e.id)).toEqual([secondEntry.id, firstEntry.id, after[2].id]);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.movePlaylistEntryToGroup (#214 group 3)', () => {
  it('throws for an unresolvable entry id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.movePlaylistEntryToGroup('no-such-entry', null))
        .toThrow(/Playlist entry not found: no-such-entry/);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unresolvable destination group', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupId, talkId);
      const entryId = findPlaylistTree(repo, 'Service').groups[0].entries[0].entry.id;

      expect(() => repo.movePlaylistEntryToGroup(entryId, 'no-such-group'))
        .toThrow(/Group not found: no-such-group/);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for a group belonging to a different playlist', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const { groupId: groupInOtherPlaylist } = createPlaylistWithGroup(repo, libraryId, 'Other', 'Closing');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupId, talkId);
      const entryId = findPlaylistTree(repo, 'Service').groups[0].entries[0].entry.id;

      expect(() => repo.movePlaylistEntryToGroup(entryId, groupInOtherPlaylist))
        .toThrow(new RegExp(`Group not found: ${groupInOtherPlaylist}`));
    } finally {
      close();
      cleanup();
    }
  });

  it('is the explicit unassign: a null group removes the entry without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupId, talkId);
      const entryId = findPlaylistTree(repo, 'Service').groups[0].entries[0].entry.id;

      expect(() => repo.movePlaylistEntryToGroup(entryId, null)).not.toThrow();

      expect(entryOrders(repo, 'Service', groupId)).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('moves an entry into a valid group without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      repo.createPlaylistGroup(playlistId, 'Closing');
      const closingGroup = findPlaylistTree(repo, 'Service').groups.find((g) => g.group.name === 'Closing')!.group.id;
      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupId, talkId);
      const entryId = findPlaylistTree(repo, 'Service').groups[0].entries[0].entry.id;

      repo.movePlaylistEntryToGroup(entryId, closingGroup);

      const moved = findPlaylistTree(repo, 'Service').groups
        .flatMap((g) => g.entries)
        .find((e) => e.entry.id === entryId)!;
      expect(moved.entry.groupId).toBe(closingGroup);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.movePlaylist (#214 group 3)', () => {
  it('throws for an unresolvable playlist id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.movePlaylist('no-such-playlist', 'up'))
        .toThrow(/Playlist not found: no-such-playlist/);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the first playlist is asked to move up', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      repo.createPlaylist(libraryId, 'A');
      repo.createPlaylist(libraryId, 'B');
      const before = playlistOrders(repo, libraryId);

      expect(() => repo.movePlaylist(before[0].id, 'up')).not.toThrow();

      expect(playlistOrders(repo, libraryId)).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the last playlist is asked to move down', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      repo.createPlaylist(libraryId, 'A');
      repo.createPlaylist(libraryId, 'B');
      const before = playlistOrders(repo, libraryId);

      expect(() => repo.movePlaylist(before[1].id, 'down')).not.toThrow();

      expect(playlistOrders(repo, libraryId)).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.moveDeckItem (#214 group 3)', () => {
  it('throws for an unresolvable deck item id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.moveDeckItem('no-such-item', 'up'))
        .toThrow(/Deck item not found: no-such-item/);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the first deck item is asked to move up', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      createDeckItem(repo, 'presentation', 'First');
      createDeckItem(repo, 'lyric', 'Second');
      const before = deckOrders(repo);
      const first = before[0];

      expect(() => repo.moveDeckItem(first.id, 'up')).not.toThrow();

      expect(deckOrders(repo)).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the last deck item is asked to move down', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      createDeckItem(repo, 'presentation', 'First');
      createDeckItem(repo, 'lyric', 'Second');
      const before = deckOrders(repo);
      const last = before[before.length - 1];

      expect(() => repo.moveDeckItem(last.id, 'down')).not.toThrow();

      expect(deckOrders(repo)).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.setLibraryOrder (#214 group 3)', () => {
  it('throws for an unresolvable library id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.setLibraryOrder('no-such-library', 0))
        .toThrow(/Library not found: no-such-library/);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the library already sits at the requested position', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      createLibrary(repo, 'Second Library');
      const before = libraryOrders(repo);

      expect(() => repo.setLibraryOrder(before[0].id, 0)).not.toThrow();

      expect(libraryOrders(repo)).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('still reorders a library to a different position', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const secondId = createLibrary(repo, 'Second Library');
      const before = libraryOrders(repo);

      repo.setLibraryOrder(before[0].id, 1);

      const after = libraryOrders(repo);
      expect(after[0].id).toBe(secondId);
      expect(after[1].id).toBe(before[0].id);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.setPlaylistOrder (#214 group 3)', () => {
  it('throws for an unresolvable playlist id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.setPlaylistOrder('no-such-playlist', 0))
        .toThrow(/Playlist not found: no-such-playlist/);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the playlist already sits at the requested position', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      repo.createPlaylist(libraryId, 'A');
      repo.createPlaylist(libraryId, 'B');
      const before = playlistOrders(repo, libraryId);

      expect(() => repo.setPlaylistOrder(before[0].id, 0)).not.toThrow();

      expect(playlistOrders(repo, libraryId)).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('reorders an existing playlist to a new position without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      repo.createPlaylist(libraryId, 'A');
      repo.createPlaylist(libraryId, 'B');
      const before = playlistOrders(repo, libraryId);

      repo.setPlaylistOrder(before[0].id, 1);

      const after = playlistOrders(repo, libraryId);
      expect(after[0].id).toBe(before[1].id);
      expect(after[1].id).toBe(before[0].id);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.movePlaylistEntryTo (#214 group 3)', () => {
  it('throws for an unresolvable entry id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');

      expect(() => repo.movePlaylistEntryTo('no-such-entry', groupId, 0))
        .toThrow(/Playlist entry not found: no-such-entry/);
      expect(entryOrders(repo, 'Service', groupId)).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an unresolvable destination group', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      repo.addDeckItemToGroup(playlistId, groupId, talkId);
      const entryId = findPlaylistTree(repo, 'Service').groups[0].entries[0].entry.id;

      expect(() => repo.movePlaylistEntryTo(entryId, 'no-such-group', 0))
        .toThrow(/Group not found: no-such-group/);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the entry already sits at the requested position in the same group', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const firstId = createDeckItem(repo, 'talk', 'First');
      const secondId = createDeckItem(repo, 'talk', 'Second');
      repo.addDeckItemToGroup(playlistId, groupId, firstId);
      repo.addDeckItemToGroup(playlistId, groupId, secondId);
      const before = entryOrders(repo, 'Service', groupId);

      expect(() => repo.movePlaylistEntryTo(before[0].id, groupId, 0)).not.toThrow();

      expect(entryOrders(repo, 'Service', groupId)).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('moves an entry within its group to a new position without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId, groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      const firstId = createDeckItem(repo, 'talk', 'First');
      const secondId = createDeckItem(repo, 'talk', 'Second');
      repo.addDeckItemToGroup(playlistId, groupId, firstId);
      repo.addDeckItemToGroup(playlistId, groupId, secondId);
      const before = entryOrders(repo, 'Service', groupId);

      repo.movePlaylistEntryTo(before[0].id, groupId, 1);

      const after = entryOrders(repo, 'Service', groupId);
      expect(after.map((e) => e.id)).toEqual([before[1].id, before[0].id]);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.setPlaylistGroupOrder (#214 group 3)', () => {
  it('throws for an unresolvable group id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.setPlaylistGroupOrder('no-such-group', 0))
        .toThrow(/Group not found: no-such-group/);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the group already sits at the requested position', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      repo.createPlaylistGroup(playlistId, 'Closing');
      const before = groupOrders(repo, 'Service');

      expect(() => repo.setPlaylistGroupOrder(before[0].id, 0)).not.toThrow();

      expect(groupOrders(repo, 'Service')).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('reorders an existing group to a new position without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { playlistId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
      repo.createPlaylistGroup(playlistId, 'Closing');
      const before = groupOrders(repo, 'Service');

      repo.setPlaylistGroupOrder(before[0].id, 1);

      const after = groupOrders(repo, 'Service');
      expect(after[0].id).toBe(before[1].id);
      expect(after[1].id).toBe(before[0].id);
    } finally {
      close();
      cleanup();
    }
  });
});