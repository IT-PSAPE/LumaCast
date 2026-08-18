import { describe, expect, it } from 'vitest';
import type { CastRepository } from './store';
import type { Id } from '@lumacast/kernel';
import type { ItemType, PlaylistRow } from '@lumacast/composition';
import { createTestRepository } from './test-support';

// #219 item-model refactor (decision D5): playlist groups are gone —
// `movePlaylistEntry`/`movePlaylistEntryTo` (direction- and group-scoped)
// collapse into a single absolute-position reorder, `movePlaylistRow(rowId,
// newOrder)`, that works identically on an item-entry row or a separator
// row. `movePlaylistEntryToGroup(entryId, null)` ("remove from every
// group") becomes the explicit `removePlaylistRow(rowId)`, which detaches
// any row from its playlist but — unlike a group-removal that only ever
// touched membership — must never delete the underlying
// Presentation/Lyric/Talk it referenced.

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

function rowIdsFor(repo: CastRepository, playlistId: Id): Id[] {
  return rowsFor(repo, playlistId).map((row) => row.id);
}

function addItemRow(repo: CastRepository, playlistId: Id, type: ItemType, title: string): Id {
  const itemId = createItem(repo, type, title);
  repo.addItemToPlaylist(playlistId, { type, id: itemId });
  return rowsFor(repo, playlistId).find((row) => row.kind === 'item' && row.reference.itemId === itemId)!.id;
}

describe('CastRepository.movePlaylistRow', () => {
  it('throws for an unresolvable row id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.movePlaylistRow('no-such-row', 0))
        .toThrow(/Playlist row not found: no-such-row/);
    } finally {
      close();
      cleanup();
    }
  });

  it('reorders an item row absolutely within its playlist', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const firstRow = addItemRow(repo, playlistId, 'talk', 'First');
      const secondRow = addItemRow(repo, playlistId, 'talk', 'Second');
      const thirdRow = addItemRow(repo, playlistId, 'talk', 'Third');

      repo.movePlaylistRow(thirdRow, 0);

      expect(rowIdsFor(repo, playlistId)).toEqual([thirdRow, firstRow, secondRow]);
    } finally {
      close();
      cleanup();
    }
  });

  it('moves a separator row exactly like an item row (rows are homogeneous for reordering)', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const firstRow = addItemRow(repo, playlistId, 'talk', 'First');
      const secondRow = addItemRow(repo, playlistId, 'talk', 'Second');
      const separatorPatch = repo.createSeparator(playlistId, 'Opening');
      const separatorId = separatorPatch.upserts.playlistEntries![0].id;

      // Separator was appended last; move it to the front.
      repo.movePlaylistRow(separatorId, 0);

      const rows = rowsFor(repo, playlistId);
      expect(rows.map((row) => row.id)).toEqual([separatorId, firstRow, secondRow]);
      expect(rows[0].kind).toBe('separator');
    } finally {
      close();
      cleanup();
    }
  });

  it('reorders a mix of item and separator rows together, preserving interleaving', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const openingSeparator = repo.createSeparator(playlistId, 'Opening').upserts.playlistEntries![0].id;
      const firstRow = addItemRow(repo, playlistId, 'talk', 'Welcome');
      const closingSeparator = repo.createSeparator(playlistId, 'Closing').upserts.playlistEntries![0].id;
      const secondRow = addItemRow(repo, playlistId, 'talk', 'Benediction');

      // Move "Closing" separator to sit right after "Opening", before "Welcome".
      repo.movePlaylistRow(closingSeparator, 1);

      expect(rowIdsFor(repo, playlistId)).toEqual([openingSeparator, closingSeparator, firstRow, secondRow]);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a genuine no-op when the row already sits at the requested position (does not throw, changes nothing)', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const firstRow = addItemRow(repo, playlistId, 'talk', 'First');
      const secondRow = addItemRow(repo, playlistId, 'talk', 'Second');
      const before = rowsFor(repo, playlistId);

      const patch = repo.movePlaylistRow(firstRow, 0);

      expect(patch.upserts.playlistEntries).toBeUndefined();
      const after = rowsFor(repo, playlistId);
      expect(after.map((row) => row.id)).toEqual([firstRow, secondRow]);
      expect(after.map((row) => row.updatedAt)).toEqual(before.map((row) => row.updatedAt));
    } finally {
      close();
      cleanup();
    }
  });

  it('clamps an out-of-range target position to the last valid index', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const firstRow = addItemRow(repo, playlistId, 'talk', 'First');
      const secondRow = addItemRow(repo, playlistId, 'talk', 'Second');

      repo.movePlaylistRow(firstRow, 999);

      expect(rowIdsFor(repo, playlistId)).toEqual([secondRow, firstRow]);
    } finally {
      close();
      cleanup();
    }
  });

  it('clamps a negative target position up to zero', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const firstRow = addItemRow(repo, playlistId, 'talk', 'First');
      const secondRow = addItemRow(repo, playlistId, 'talk', 'Second');

      repo.movePlaylistRow(secondRow, -5);

      expect(rowIdsFor(repo, playlistId)).toEqual([secondRow, firstRow]);
    } finally {
      close();
      cleanup();
    }
  });

  it('renumbers order_index densely (0..n-1) across the whole affected range after a move', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      addItemRow(repo, playlistId, 'talk', 'A');
      addItemRow(repo, playlistId, 'talk', 'B');
      const rowC = addItemRow(repo, playlistId, 'talk', 'C');
      addItemRow(repo, playlistId, 'talk', 'D');

      repo.movePlaylistRow(rowC, 0);

      expect(rowsFor(repo, playlistId).map((row) => row.order)).toEqual([0, 1, 2, 3]);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.removePlaylistRow', () => {
  it('detaches an item row, leaving the underlying item fully intact', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const talkId = createItem(repo, 'talk', 'Sermon');
      repo.addItemToPlaylist(playlistId, { type: 'talk', id: talkId });
      const rowId = rowsFor(repo, playlistId)[0].id;

      const patch = repo.removePlaylistRow(rowId);

      expect(patch.deletes.playlistEntries).toEqual([rowId]);
      expect(rowsFor(repo, playlistId)).toHaveLength(0);
      // The Talk itself was never touched — this is a detach, not a delete.
      const snapshot = repo.getSnapshot();
      expect(snapshot.talks.some((talk) => talk.id === talkId)).toBe(true);
      expect(snapshot.talks.find((talk) => talk.id === talkId)?.title).toBe('Sermon');
    } finally {
      close();
      cleanup();
    }
  });

  it('detaches a separator row without touching sibling item rows', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const separatorId = repo.createSeparator(playlistId, 'Opening').upserts.playlistEntries![0].id;
      const itemRowId = addItemRow(repo, playlistId, 'talk', 'Sermon');

      repo.removePlaylistRow(separatorId);

      const rows = rowsFor(repo, playlistId);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(itemRowId);
    } finally {
      close();
      cleanup();
    }
  });

  it('is a silent no-op (returns an empty patch, does not throw) for an already-removed row id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const rowId = addItemRow(repo, playlistId, 'talk', 'Sermon');
      repo.removePlaylistRow(rowId);

      const patch = repo.removePlaylistRow(rowId);

      expect(patch.deletes.playlistEntries).toBeUndefined();
      expect(patch.upserts.playlistEntries).toBeUndefined();
    } finally {
      close();
      cleanup();
    }
  });

  it('densely renumbers the remaining rows after a removal from the middle', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistId = createPlaylist(repo, 'Service');
      const rowA = addItemRow(repo, playlistId, 'talk', 'A');
      const rowB = addItemRow(repo, playlistId, 'talk', 'B');
      const rowC = addItemRow(repo, playlistId, 'talk', 'C');

      const patch = repo.removePlaylistRow(rowB);

      const rows = rowsFor(repo, playlistId);
      expect(rows.map((row) => row.id)).toEqual([rowA, rowC]);
      expect(rows.map((row) => row.order)).toEqual([0, 1]);
      // The renumbered survivor's id is reported so undo/redo can refresh it.
      expect(patch.upserts.playlistEntries?.map((row) => row.id)).toEqual([rowC]);
    } finally {
      close();
      cleanup();
    }
  });

  it('leaves a second playlist entirely untouched', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const playlistAId = createPlaylist(repo, 'Service A');
      const playlistBId = createPlaylist(repo, 'Service B');
      const rowA = addItemRow(repo, playlistAId, 'talk', 'A');
      const rowB = addItemRow(repo, playlistBId, 'talk', 'B');

      repo.removePlaylistRow(rowA);

      expect(rowsFor(repo, playlistAId)).toHaveLength(0);
      expect(rowIdsFor(repo, playlistBId)).toEqual([rowB]);
    } finally {
      close();
      cleanup();
    }
  });
});
