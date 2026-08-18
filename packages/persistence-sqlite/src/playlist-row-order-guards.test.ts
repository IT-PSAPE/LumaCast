import { describe, expect, it } from 'vitest';
import type { CastRepository } from './store';
import type { Id } from '@lumacast/kernel';
import type { ItemType } from '@lumacast/composition';
import { createTestRepository } from './test-support';

// #219 item-model refactor (decision D5): playlist groups are destroyed, but
// the ordering invariants they used to guard still apply to the flat row
// model — every playlist's rows are densely ordered 0..n-1, playlist-level
// ordering guards distinguish a genuine no-op from a failed lookup, and
// deleting a playlist must cascade its rows rather than orphaning them.
// This file also pins createSeparator/renameSeparator/setSeparatorColor's
// existence guards, including the kind-discrimination guard: an item-entry
// row id must never satisfy a separator-only mutation.

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

function playlistOrders(repo: CastRepository): Array<{ id: Id; order: number }> {
  return repo.getSnapshot().playlists.map((p) => ({ id: p.id, order: p.order }));
}

function rowOrdersFor(repo: CastRepository, playlistId: Id): number[] {
  return repo
    .getSnapshot()
    .playlistEntries.filter((row) => row.playlistId === playlistId)
    .map((row) => row.order)
    .sort((a, b) => a - b);
}

function addItemRow(repo: CastRepository, playlistId: Id, type: ItemType, title: string): Id {
  const itemId = createItem(repo, type, title);
  repo.addItemToPlaylist(playlistId, { type, id: itemId });
  return itemId;
}

describe('CastRepository.createSeparator', () => {
  it('throws for an unresolvable playlist id and creates nothing', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      expect(() => repo.createSeparator('no-such-playlist', 'Opening'))
        .toThrow(/Playlist not found: no-such-playlist/);
      expect(repo.getSnapshot().playlistEntries).toHaveLength(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('creates a separator row appended at the end of the playlist', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const playlistId = createPlaylist(repo, 'Service');
      addItemRow(repo, playlistId, 'talk', 'Sermon');

      const patch = repo.createSeparator(playlistId, 'Opening');

      const separator = patch.upserts.playlistEntries?.[0];
      expect(separator?.kind).toBe('separator');
      if (separator?.kind === 'separator') {
        expect(separator.label).toBe('Opening');
        expect(separator.colorKey).toBeNull();
        expect(separator.order).toBe(1);
      }
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.renameSeparator', () => {
  it('throws for an unresolvable row id', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      expect(() => repo.renameSeparator('no-such-row', 'Renamed'))
        .toThrow(/Separator not found: no-such-row/);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws when given an item-entry row id (kind discrimination — an item row is not a separator)', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const talkId = addItemRow(repo, playlistId, 'talk', 'Sermon');
      const itemRowId = repo.getSnapshot().playlistEntries.find((row) => row.kind === 'item' && row.reference.itemId === talkId)!.id;

      expect(() => repo.renameSeparator(itemRowId, 'Renamed'))
        .toThrow(new RegExp(`Separator not found: ${itemRowId}`));
    } finally {
      close();
      cleanup();
    }
  });

  it('renames an existing separator without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const separatorId = repo.createSeparator(playlistId, 'Opening').upserts.playlistEntries![0].id;

      const patch = repo.renameSeparator(separatorId, 'Renamed');

      const separator = patch.upserts.playlistEntries?.[0];
      expect(separator?.kind).toBe('separator');
      if (separator?.kind === 'separator') expect(separator.label).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.setSeparatorColor', () => {
  it('throws for an unresolvable row id', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      expect(() => repo.setSeparatorColor('no-such-row', 'red'))
        .toThrow(/Separator not found: no-such-row/);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws when given an item-entry row id', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const talkId = addItemRow(repo, playlistId, 'talk', 'Sermon');
      const itemRowId = repo.getSnapshot().playlistEntries.find((row) => row.kind === 'item' && row.reference.itemId === talkId)!.id;

      expect(() => repo.setSeparatorColor(itemRowId, 'red'))
        .toThrow(new RegExp(`Separator not found: ${itemRowId}`));
    } finally {
      close();
      cleanup();
    }
  });

  it('sets an existing separator\'s color without throwing, and clears it back to null', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const separatorId = repo.createSeparator(playlistId, 'Opening').upserts.playlistEntries![0].id;

      const patch = repo.setSeparatorColor(separatorId, 'blue');
      const separator = patch.upserts.playlistEntries?.[0];
      expect(separator?.kind).toBe('separator');
      if (separator?.kind === 'separator') expect(separator.colorKey).toBe('blue');

      const cleared = repo.setSeparatorColor(separatorId, null);
      const clearedSeparator = cleared.upserts.playlistEntries?.[0];
      if (clearedSeparator?.kind === 'separator') expect(clearedSeparator.colorKey).toBeNull();
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.movePlaylist', () => {
  it('throws for an unresolvable playlist id', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      // movePlaylist shares its lookup with the per-type item reorder ops
      // (moveItemOrder is generic over the table name), so the message
      // names the table rather than the domain word "Playlist".
      expect(() => repo.movePlaylist('no-such-playlist', 'up'))
        .toThrow(/Row not found in playlists: no-such-playlist/);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the first playlist is asked to move up', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      createPlaylist(repo, 'A');
      createPlaylist(repo, 'B');
      const before = playlistOrders(repo);

      const patch = repo.movePlaylist(before[0].id, 'up');

      expect(patch.upserts.playlists).toBeUndefined();
      expect(playlistOrders(repo)).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the last playlist is asked to move down', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      createPlaylist(repo, 'A');
      createPlaylist(repo, 'B');
      const before = playlistOrders(repo);

      const patch = repo.movePlaylist(before[1].id, 'down');

      expect(patch.upserts.playlists).toBeUndefined();
      expect(playlistOrders(repo)).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('still swaps two playlists when moved toward each other', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      createPlaylist(repo, 'A');
      createPlaylist(repo, 'B');
      const before = playlistOrders(repo);

      repo.movePlaylist(before[1].id, 'up');

      const after = playlistOrders(repo);
      expect(after.find((p) => p.id === before[1].id)?.order).toBe(before[0].order);
      expect(after.find((p) => p.id === before[0].id)?.order).toBe(before[1].order);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.setPlaylistOrder', () => {
  it('throws for an unresolvable playlist id', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      expect(() => repo.setPlaylistOrder('no-such-playlist', 0))
        .toThrow(/Playlist not found: no-such-playlist/);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the playlist already sits at the requested position', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      createPlaylist(repo, 'A');
      createPlaylist(repo, 'B');
      const before = playlistOrders(repo);

      const patch = repo.setPlaylistOrder(before[0].id, 0);

      expect(patch.upserts.playlists).toBeUndefined();
      expect(playlistOrders(repo)).toEqual(before);
    } finally {
      close();
      cleanup();
    }
  });

  it('reorders an existing playlist to a new position without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      createPlaylist(repo, 'A');
      createPlaylist(repo, 'B');
      const before = playlistOrders(repo);

      repo.setPlaylistOrder(before[0].id, 1);

      const after = playlistOrders(repo);
      expect(after.find((p) => p.id === before[0].id)?.order).toBe(1);
      expect(after.find((p) => p.id === before[1].id)?.order).toBe(0);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.deletePlaylist cascades its rows', () => {
  it('removes the playlist and every one of its rows (item entries and separators)', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const talkId = createItem(repo, 'talk', 'Sermon');
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: talkId });
      repo.createSeparator(playlistId, 'Opening');
      const rowIdsBefore = repo
        .getSnapshot()
        .playlistEntries.filter((row) => row.playlistId === playlistId)
        .map((row) => row.id);
      expect(rowIdsBefore).toHaveLength(2);

      const patch = repo.deletePlaylist(playlistId);

      expect(patch.deletes.playlists).toEqual([playlistId]);
      // The cascade must be visible in the patch itself: undo/redo consumers
      // mirror patches without re-reading the snapshot.
      expect([...(patch.deletes.playlistEntries ?? [])].sort()).toEqual([...rowIdsBefore].sort());
      expect(repo.getSnapshot().playlists.some((p) => p.id === playlistId)).toBe(false);
      // Cascade: no orphaned rows survive pointing at the deleted playlist.
      expect(repo.getSnapshot().playlistEntries.some((row) => row.playlistId === playlistId)).toBe(false);
      // The underlying Talk is untouched by deleting the playlist that referenced it.
      expect(repo.getSnapshot().talks.some((talk) => talk.id === talkId)).toBe(true);
    } finally {
      close();
      cleanup();
    }
  });

  it('leaves a second playlist and its rows completely untouched', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const playlistAId = createPlaylist(repo, 'Service A');
      const playlistBId = createPlaylist(repo, 'Service B');
      addItemRow(repo, playlistBId, 'talk', 'Sermon');
      const beforeBRows = rowOrdersFor(repo, playlistBId);

      repo.deletePlaylist(playlistAId);

      expect(repo.getSnapshot().playlists.some((p) => p.id === playlistBId)).toBe(true);
      expect(rowOrdersFor(repo, playlistBId)).toEqual(beforeBRows);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('per-playlist dense order invariants', () => {
  it('stays dense (0..n-1, no gaps or duplicates) through a sequence of adds, a removal, and a move', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const playlistId = createPlaylist(repo, 'Service');
      addItemRow(repo, playlistId, 'talk', 'A');
      const bId = addItemRow(repo, playlistId, 'talk', 'B');
      addItemRow(repo, playlistId, 'talk', 'C');
      repo.createSeparator(playlistId, 'Midpoint');
      addItemRow(repo, playlistId, 'talk', 'D');

      const rowBEntryId = repo.getSnapshot().playlistEntries.find((row) => row.kind === 'item' && row.reference.itemId === bId)!.id;
      repo.removePlaylistRow(rowBEntryId);
      repo.movePlaylistRow(repo.getSnapshot().playlistEntries.filter((r) => r.playlistId === playlistId)[0].id, 2);

      const orders = rowOrdersFor(repo, playlistId);
      expect(orders).toEqual([0, 1, 2, 3]);
    } finally {
      close();
      cleanup();
    }
  });

  it('is scoped per playlist — one playlist\'s order sequence never affects another\'s', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const playlistAId = createPlaylist(repo, 'Service A');
      const playlistBId = createPlaylist(repo, 'Service B');
      addItemRow(repo, playlistAId, 'talk', 'A1');
      addItemRow(repo, playlistAId, 'talk', 'A2');
      addItemRow(repo, playlistBId, 'talk', 'B1');

      expect(rowOrdersFor(repo, playlistAId)).toEqual([0, 1]);
      expect(rowOrdersFor(repo, playlistBId)).toEqual([0]);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('playlist mutation patch shapes', () => {
  it('never carries a libraryBundles key or a replace key on playlist-touching patches', () => {
    const { repository: repo, close, cleanup } = createTestRepository({ seed: false });
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const talkId = createItem(repo, 'talk', 'Sermon');
      const patches = [
        repo.addItemToPlaylist(playlistId, { type: 'talk', id: talkId }),
        repo.createSeparator(playlistId, 'Opening'),
        repo.renamePlaylist(playlistId, 'Renamed'),
      ];

      for (const patch of patches) {
        expect(Object.prototype.hasOwnProperty.call(patch.upserts, 'libraryBundles')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(patch.deletes, 'libraryBundles')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(patch, 'replace')).toBe(false);
        // Ordinary upsert semantics only: playlists/playlistEntries keys, when
        // present, are plain arrays — never a full-replacement marker object.
        if (patch.upserts.playlists) expect(Array.isArray(patch.upserts.playlists)).toBe(true);
        if (patch.upserts.playlistEntries) expect(Array.isArray(patch.upserts.playlistEntries)).toBe(true);
      }
    } finally {
      close();
      cleanup();
    }
  });
});
