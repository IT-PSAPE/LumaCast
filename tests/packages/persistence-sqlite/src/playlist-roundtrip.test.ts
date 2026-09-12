import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Id } from '@lumacast/kernel';
import type { ItemType, PlaylistItemEntry, PlaylistRow } from '@lumacast/composition';
import type { BundleManifest } from '@lumacast/protocol';
import { CastRepository } from '../../../../packages/persistence-sqlite/src/store';

let repo: CastRepository;
let tmpDir: string;

function closeRepo(target: CastRepository): void {
  (target as unknown as { db: { close(): void } }).db.close();
}

function makeRepo(dir: string): CastRepository {
  // These tests exercise playlists they create themselves, and several
  // assert an absolute playlistEntries/playlists count after a rejected
  // import — seeding is disabled so those counts stay meaningful without
  // hand-filtering starter content out of every assertion.
  return new CastRepository({ dbPath: path.join(dir, 'lumacast.sqlite'), userDataPath: dir, documentsPath: dir, seed: false });
}

function createItem(target: CastRepository, type: ItemType, title: string): Id {
  const { itemId } = target.createItem({ type, title });
  return itemId;
}

function createPlaylist(target: CastRepository, name: string): Id {
  const patch = target.createPlaylist(name);
  const playlist = patch.upserts.playlists?.[0];
  if (!playlist) throw new Error('createPlaylist returned no playlist');
  return playlist.id;
}

function rowsFor(target: CastRepository, playlistId: Id): PlaylistRow[] {
  return target
    .getSnapshot()
    .playlistEntries.filter((row) => row.playlistId === playlistId)
    .slice()
    .sort((a, b) => a.order - b.order);
}

function itemEntriesFor(target: CastRepository, playlistId: Id): PlaylistItemEntry[] {
  return rowsFor(target, playlistId).filter((row): row is PlaylistItemEntry => row.kind === 'item');
}

function buildMinimalManifest(): BundleManifest {
  return {
    format: 'cast-deck-bundle',
    version: 3,
    exportedAt: new Date().toISOString(),
    items: [
      { id: 'presentation-1', type: 'presentation', title: 'Deck', themeId: null, order: 0, slides: [] },
    ],
    themes: [],
    mediaReferences: [],
    playlists: [
      {
        id: 'playlist-1',
        name: 'Service',
        order: 0,
        rows: [
          { id: 'entry-1', kind: 'item', presentationId: 'presentation-1', lyricId: null, order: 0 },
        ],
      },
    ],
  };
}

describe('playlist item reference round trips', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-playlist-test-'));
    repo = makeRepo(tmpDir);
  });

  afterEach(() => {
    closeRepo(repo);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds Presentation and Lyric entries each with a correct canonical reference', () => {
    const playlistId = createPlaylist(repo, 'Service');
    const presentationId = createItem(repo, 'presentation', 'Slides');
    const lyricId = createItem(repo, 'lyric', 'Song');

    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });
    repo.addItemToPlaylist(playlistId, { type: 'lyric', id: lyricId });

    const entries = itemEntriesFor(repo, playlistId);
    expect(entries).toHaveLength(2);

    const presentationEntry = entries.find((e) => e.reference.itemId === presentationId);
    expect(presentationEntry?.reference).toEqual({ type: 'presentation', itemId: presentationId });
    expect(presentationEntry?.presentationId).toBe(presentationId);
    expect(presentationEntry?.lyricId).toBeNull();

    const lyricEntry = entries.find((e) => e.reference.itemId === lyricId);
    expect(lyricEntry?.reference).toEqual({ type: 'lyric', itemId: lyricId });
    expect(lyricEntry?.presentationId).toBeNull();
    expect(lyricEntry?.lyricId).toBe(lyricId);
  });

  it('preserves row identity and referenced item identity across a movePlaylistRow reorder', () => {
    const playlistId = createPlaylist(repo, 'Service');
    const presentationId = createItem(repo, 'presentation', 'Slides');
    const lyricId = createItem(repo, 'lyric', 'Song');
    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });
    repo.addItemToPlaylist(playlistId, { type: 'lyric', id: lyricId });

    const before = itemEntriesFor(repo, playlistId);
    const presentationRowId = before.find((e) => e.reference.itemId === presentationId)!.id;

    repo.movePlaylistRow(presentationRowId, 1);

    const after = itemEntriesFor(repo, playlistId);
    const presentationRowAfter = after.find((e) => e.id === presentationRowId);
    expect(presentationRowAfter).toBeTruthy();
    expect(presentationRowAfter?.reference).toEqual({ type: 'presentation', itemId: presentationId });
    expect(after.map((e) => e.id)).not.toEqual(before.map((e) => e.id));
    expect(new Set(after.map((e) => e.id))).toEqual(new Set(before.map((e) => e.id)));
  });

  it('survives closing and reopening the database ("restart")', () => {
    const playlistId = createPlaylist(repo, 'Service');
    const presentationId = createItem(repo, 'presentation', 'Deck');
    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });

    closeRepo(repo);
    repo = makeRepo(tmpDir);

    const entries = itemEntriesFor(repo, playlistId);
    expect(entries).toHaveLength(1);
    expect(entries[0].reference).toEqual({ type: 'presentation', itemId: presentationId });
  });

  it('exports and re-imports a Presentation-only playlist without losing the entry (regression: export used to drop Presentation entries)', () => {
    const playlistId = createPlaylist(repo, 'Service');
    const presentationId = createItem(repo, 'presentation', 'Deck');
    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });

    const manifest = repo.exportBundle([], { playlistIds: [playlistId] });

    expect(manifest.playlists).toHaveLength(1);
    const exportedRows = manifest.playlists![0].rows;
    expect(exportedRows).toHaveLength(1);
    const exportedEntry = exportedRows[0];
    expect(exportedEntry.kind).toBe('item');
    if (exportedEntry.kind === 'item') {
      expect(exportedEntry.presentationId).toBe(presentationId);
      expect(exportedEntry.lyricId).toBeNull();
    }
    // The referenced item itself must be included in the bundle.
    expect(manifest.items.some((item) => item.id === presentationId)).toBe(true);

    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-playlist-import-'));
    const importRepo = makeRepo(importDir);
    try {
      const inspection = importRepo.inspectImportBundle(manifest);
      expect(inspection.brokenReferences).toHaveLength(0);
      expect(inspection.playlists[0]?.entryCount).toBe(1);
      expect(inspection.playlists[0]?.separatorCount).toBe(0);
      importRepo.finalizeImportBundle(manifest, []);

      const importedPlaylist = importRepo.getSnapshot().playlists.find((p) => p.name === 'Service');
      expect(importedPlaylist).toBeTruthy();
      const importedEntries = itemEntriesFor(importRepo, importedPlaylist!.id);
      expect(importedEntries).toHaveLength(1);
      const importedPresentation = importRepo.getSnapshot().presentations.find((t) => t.id === importedEntries[0].reference.itemId);
      expect(importedPresentation?.title).toBe('Deck');
      expect(importedEntries[0].reference.type).toBe('presentation');
      // Import mints new row and item ids; content identity survives via title/type.
      expect(importedEntries[0].id).not.toBe(exportedEntry.id);
      expect(importedEntries[0].reference.itemId).not.toBe(presentationId);
    } finally {
      closeRepo(importRepo);
      fs.rmSync(importDir, { recursive: true, force: true });
    }
  });

  it('exports a playlist containing a separator, and the separator survives import intact', () => {
    const playlistId = createPlaylist(repo, 'Service');
    repo.createSeparator(playlistId, 'Opening');
    const presentationId = createItem(repo, 'presentation', 'Deck');
    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });

    const manifest = repo.exportBundle([], { playlistIds: [playlistId] });
    const rows = manifest.playlists![0].rows;
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('separator');
    if (rows[0].kind === 'separator') expect(rows[0].label).toBe('Opening');
    expect(rows[1].kind).toBe('item');

    const inspection = repo.inspectImportBundle(manifest);
    expect(inspection.playlists[0]?.separatorCount).toBe(1);
    expect(inspection.playlists[0]?.entryCount).toBe(1);

    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-playlist-separator-import-'));
    const importRepo = makeRepo(importDir);
    try {
      importRepo.finalizeImportBundle(manifest, []);
      const importedPlaylist = importRepo.getSnapshot().playlists.find((p) => p.name === 'Service');
      const importedRows = rowsFor(importRepo, importedPlaylist!.id);
      expect(importedRows).toHaveLength(2);
      expect(importedRows.find((row) => row.kind === 'separator')).toBeTruthy();
    } finally {
      closeRepo(importRepo);
      fs.rmSync(importDir, { recursive: true, force: true });
    }
  });

  it('rejects an import manifest playlist row with zero populated owners, without partially importing it', () => {
    const manifest = buildMinimalManifest();
    manifest.playlists![0].rows[0] = {
      id: 'entry-1',
      kind: 'item',
      presentationId: null,
      lyricId: null,
      order: 0,
    };

    expect(() => repo.inspectImportBundle(manifest)).toThrow(/missing an owner/);
    expect(() => repo.finalizeImportBundle(manifest, [])).toThrow(/missing an owner/);
    expect(repo.getSnapshot().playlists).toHaveLength(0);
  });

  it('rejects an import manifest playlist row with multiple populated owners, without partially importing it', () => {
    const manifest = buildMinimalManifest();
    manifest.playlists![0].rows[0] = {
      id: 'entry-1',
      kind: 'item',
      presentationId: 'stray-presentation-id',
      lyricId: 'stray-lyric-id',
      order: 0,
    };

    expect(() => repo.inspectImportBundle(manifest)).toThrow(/multiple owners/);
    expect(() => repo.finalizeImportBundle(manifest, [])).toThrow(/multiple owners/);
    expect(repo.getSnapshot().playlists).toHaveLength(0);
  });

  it('imports a legacy v1 bundle by discarding Talk content while retaining the presentation and its row', () => {
    const legacyManifest = {
      format: 'cast-deck-bundle',
      version: 1,
      exportedAt: new Date().toISOString(),
      items: [
        { id: 'presentation-1', type: 'presentation', title: 'Deck', themeId: null, order: 0, slides: [] },
        { id: 'talk-1', type: 'talk', title: 'Legacy Talk', themeId: null, order: 1, slides: [] },
      ],
      themes: [],
      mediaReferences: [],
      playlists: [
        {
          id: 'playlist-1',
          name: 'Service',
          libraryName: 'Imported',
          order: 0,
          groups: [
            {
              id: 'group-1',
              name: 'Opening',
              colorKey: 'blue',
              order: 0,
              entries: [
                { id: 'entry-1', presentationId: 'presentation-1', lyricId: null, talkId: null, order: 0 },
                { id: 'entry-talk', presentationId: null, lyricId: null, talkId: 'talk-1', order: 1 },
              ],
            },
          ],
        },
      ],
    };

    const inspection = repo.inspectImportBundle(legacyManifest as unknown as BundleManifest);
    expect(inspection.itemCount).toBe(1);
    expect(inspection.playlists[0]).toMatchObject({ name: 'Service', separatorCount: 1, entryCount: 1 });

    const after = repo.finalizeImportBundle(legacyManifest as unknown as BundleManifest, []);
    const importedPresentation = after.presentations.find((presentation) => presentation.title === 'Deck')!;
    expect(importedPresentation).toBeTruthy();
    expect(after.presentations.some((presentation) => presentation.title === 'Legacy Talk')).toBe(false);
    const importedPlaylist = after.playlists.find((p) => p.name === 'Service')!;
    const importedRows = after.playlistEntries
      .filter((row) => row.playlistId === importedPlaylist.id)
      .sort((left, right) => left.order - right.order);
    expect(importedRows).toHaveLength(2);
    expect(importedRows[0]).toMatchObject({ kind: 'separator', label: 'Opening', colorKey: 'blue' });
    expect(importedRows[1].kind).toBe('item');
    expect((importedRows[1] as PlaylistItemEntry).reference).toEqual({ type: 'presentation', itemId: importedPresentation.id });
  });

  it('rejects an unsupported (non-legacy) bundle version explicitly, without a partial import', () => {
    const manifest = buildMinimalManifest();
    (manifest as unknown as { version: number }).version = 4;

    expect(() => repo.inspectImportBundle(manifest)).toThrow(/future bundle version 4/);
    expect(() => repo.finalizeImportBundle(manifest, [])).toThrow(/future bundle version 4/);
    expect(repo.getSnapshot().playlists).toHaveLength(0);
  });

  it('allows duplicate entries referencing the same item, each keeping its own row identity', () => {
    const playlistId = createPlaylist(repo, 'Service');
    const presentationId = createItem(repo, 'presentation', 'Deck');

    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });
    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });

    const entries = itemEntriesFor(repo, playlistId);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).not.toBe(entries[1].id);
    expect(entries.every((e) => e.reference.itemId === presentationId)).toBe(true);
  });

  it('round-trips a full snapshot restore, preserving the Presentation entry reference', () => {
    const playlistId = createPlaylist(repo, 'Service');
    const presentationId = createItem(repo, 'presentation', 'Deck');
    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });

    const snapshot = repo.getSnapshot();

    const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-playlist-restore-'));
    const restoreRepo = makeRepo(restoreDir);
    try {
      restoreRepo.restoreFromSnapshot(snapshot);
      const entries = itemEntriesFor(restoreRepo, playlistId);
      expect(entries).toHaveLength(1);
      expect(entries[0].reference).toEqual({ type: 'presentation', itemId: presentationId });
      expect(entries[0].presentationId).toBe(presentationId);
    } finally {
      closeRepo(restoreRepo);
      fs.rmSync(restoreDir, { recursive: true, force: true });
    }
  });

  it('round-trips a full snapshot restore of a separator row, preserving its label and color', () => {
    const playlistId = createPlaylist(repo, 'Service');
    repo.createSeparator(playlistId, 'Opening');
    repo.setSeparatorColor(rowsFor(repo, playlistId)[0].id, 'blue');

    const snapshot = repo.getSnapshot();
    const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-separator-restore-'));
    const restoreRepo = makeRepo(restoreDir);
    try {
      restoreRepo.restoreFromSnapshot(snapshot);
      const rows = rowsFor(restoreRepo, playlistId);
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe('separator');
      if (rows[0].kind === 'separator') {
        expect(rows[0].label).toBe('Opening');
        expect(rows[0].colorKey).toBe('blue');
      }
    } finally {
      closeRepo(restoreRepo);
      fs.rmSync(restoreDir, { recursive: true, force: true });
    }
  });

  it('kind-discrimination: a snapshot with a separator row never reaches parsePlaylistItemReference and never throws', () => {
    const playlistId = createPlaylist(repo, 'Service');
    repo.createSeparator(playlistId, 'Opening');
    const presentationId = createItem(repo, 'presentation', 'Deck');
    repo.addItemToPlaylist(playlistId, { type: 'presentation', id: presentationId });
    repo.createSeparator(playlistId, 'Closing');

    // Reading the whole snapshot exercises every playlist_entries row
    // through the same toPlaylistRow conversion getSnapshot uses; if a
    // separator's (always-null) owner columns were ever handed to
    // parsePlaylistItemReference, this would throw "missing an owner".
    expect(() => repo.getSnapshot()).not.toThrow();

    const rows = rowsFor(repo, playlistId);
    expect(rows.map((row) => row.kind)).toEqual(['separator', 'item', 'separator']);
    const separators = rows.filter((row) => row.kind === 'separator');
    expect(separators).toHaveLength(2);
    // Separator rows carry no reference/owner fields at all in the domain type.
    for (const separator of separators) {
      expect((separator as unknown as { reference?: unknown }).reference).toBeUndefined();
    }
  });
});
