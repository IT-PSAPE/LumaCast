import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeckBundleManifest, Id, PlaylistEntry, PlaylistTree } from '@core/types';
import { CastRepository } from './store';

let repo: CastRepository;
let tmpDir: string;

function closeRepo(target: CastRepository): void {
  (target as unknown as { db: { close(): void } }).db.close();
}

function makeRepo(dir: string): CastRepository {
  return new CastRepository({ dbPath: path.join(dir, 'lumacast.sqlite'), userDataPath: dir, documentsPath: dir });
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

function findPlaylistTree(target: CastRepository, playlistName: string): PlaylistTree {
  for (const bundle of target.getSnapshot().libraryBundles) {
    const tree = bundle.playlists.find((t) => t.playlist.name === playlistName);
    if (tree) return tree;
  }
  throw new Error(`playlist not found: ${playlistName}`);
}

function entriesFor(target: CastRepository, playlistName: string) {
  return findPlaylistTree(target, playlistName).groups.flatMap((g) => g.entries);
}

function createPlaylistWithGroup(
  target: CastRepository,
  libraryId: Id,
  playlistName: string,
  groupName: string,
): { playlistId: Id; groupId: Id } {
  target.createPlaylist(libraryId, playlistName);
  const tree = findPlaylistTree(target, playlistName);
  target.createPlaylistGroup(tree.playlist.id, groupName);
  const updated = findPlaylistTree(target, playlistName);
  const group = updated.groups.find((g) => g.group.name === groupName);
  if (!group) throw new Error(`group not found: ${groupName}`);
  return { playlistId: tree.playlist.id, groupId: group.group.id };
}

function buildMinimalTalkManifest(): DeckBundleManifest {
  return {
    format: 'cast-deck-bundle',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: [
      { id: 'talk-1', type: 'talk', title: 'Sermon', themeId: null, order: 0, slides: [] },
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
            colorKey: null,
            order: 0,
            entries: [
              { id: 'entry-1', presentationId: null, lyricId: null, talkId: 'talk-1', order: 0 },
            ],
          },
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

  it('adds Presentation, Lyric, and Talk entries each with a correct canonical reference', () => {
    const libraryId = createLibrary(repo, 'Library');
    const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');

    const presentationId = createDeckItem(repo, 'presentation', 'Slides');
    const lyricId = createDeckItem(repo, 'lyric', 'Song');
    const talkId = createDeckItem(repo, 'talk', 'Sermon');

    repo.addDeckItemToGroup(groupId, presentationId);
    repo.addDeckItemToGroup(groupId, lyricId);
    repo.addDeckItemToGroup(groupId, talkId);

    const entries = entriesFor(repo, 'Service');
    expect(entries).toHaveLength(3);

    const talkEntry = entries.find((e) => e.item.id === talkId);
    expect(talkEntry?.entry.reference).toEqual({ type: 'talk', itemId: talkId });
    expect(talkEntry?.entry.talkId).toBe(talkId);
    expect(talkEntry?.entry.presentationId).toBeNull();
    expect(talkEntry?.entry.lyricId).toBeNull();

    const presentationEntry = entries.find((e) => e.item.id === presentationId);
    expect(presentationEntry?.entry.reference).toEqual({ type: 'presentation', itemId: presentationId });

    const lyricEntry = entries.find((e) => e.item.id === lyricId);
    expect(lyricEntry?.entry.reference).toEqual({ type: 'lyric', itemId: lyricId });
  });

  it('preserves entry identity and referenced item identity across reordering', () => {
    const libraryId = createLibrary(repo, 'Library');
    const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
    const talkId = createDeckItem(repo, 'talk', 'Sermon');
    const presentationId = createDeckItem(repo, 'presentation', 'Slides');
    repo.addDeckItemToGroup(groupId, talkId);
    repo.addDeckItemToGroup(groupId, presentationId);

    const before = entriesFor(repo, 'Service');
    const talkEntryId = before.find((e) => e.item.id === talkId)!.entry.id;

    repo.movePlaylistEntry(talkEntryId, 'down');

    const after = entriesFor(repo, 'Service');
    const talkEntryAfter = after.find((e) => e.entry.id === talkEntryId);
    expect(talkEntryAfter).toBeTruthy();
    expect(talkEntryAfter?.entry.reference).toEqual({ type: 'talk', itemId: talkId });
    expect(after.map((e) => e.entry.id)).not.toEqual(before.map((e) => e.entry.id));
    expect(new Set(after.map((e) => e.entry.id))).toEqual(new Set(before.map((e) => e.entry.id)));
  });

  it('is a no-op at reorder boundaries (moving the last entry down, or the first entry up)', () => {
    const libraryId = createLibrary(repo, 'Library');
    const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
    const talkId = createDeckItem(repo, 'talk', 'Sermon');
    const presentationId = createDeckItem(repo, 'presentation', 'Slides');
    repo.addDeckItemToGroup(groupId, talkId);
    repo.addDeckItemToGroup(groupId, presentationId);

    const before = entriesFor(repo, 'Service');
    const firstEntryId = before[0].entry.id;
    const lastEntryId = before[before.length - 1].entry.id;

    repo.movePlaylistEntry(firstEntryId, 'up');
    repo.movePlaylistEntry(lastEntryId, 'down');

    const after = entriesFor(repo, 'Service');
    expect(after.map((e) => e.entry.id)).toEqual(before.map((e) => e.entry.id));
    expect(after.map((e) => e.entry.reference)).toEqual(before.map((e) => e.entry.reference));
  });

  it('moving a Talk entry to another group keeps its reference intact', () => {
    const libraryId = createLibrary(repo, 'Library');
    const { playlistId, groupId: groupA } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
    repo.createPlaylistGroup(playlistId, 'Closing');
    const tree = findPlaylistTree(repo, 'Service');
    const groupB = tree.groups.find((g) => g.group.name === 'Closing')!.group.id;

    const talkId = createDeckItem(repo, 'talk', 'Sermon');
    repo.addDeckItemToGroup(groupA, talkId);

    repo.moveDeckItemToGroup(playlistId, talkId, groupB);

    const entries = entriesFor(repo, 'Service');
    expect(entries).toHaveLength(1);
    expect(entries[0].entry.groupId).toBe(groupB);
    expect(entries[0].entry.reference).toEqual({ type: 'talk', itemId: talkId });
  });

  it('survives closing and reopening the database ("restart")', () => {
    const libraryId = createLibrary(repo, 'Library');
    const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
    const talkId = createDeckItem(repo, 'talk', 'Sermon');
    repo.addDeckItemToGroup(groupId, talkId);

    closeRepo(repo);
    repo = makeRepo(tmpDir);

    const entries = entriesFor(repo, 'Service');
    expect(entries).toHaveLength(1);
    expect(entries[0].entry.reference).toEqual({ type: 'talk', itemId: talkId });
  });

  it('exports and re-imports a Talk-only playlist without losing the entry (regression: export used to drop Talk entries)', () => {
    const libraryId = createLibrary(repo, 'Library');
    const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
    const talkId = createDeckItem(repo, 'talk', 'Sermon');
    repo.addDeckItemToGroup(groupId, talkId);

    const tree = findPlaylistTree(repo, 'Service');
    const manifest = repo.exportDeckBundle([], { playlistIds: [tree.playlist.id] });

    expect(manifest.playlists).toHaveLength(1);
    const exportedEntries = manifest.playlists![0].groups.flatMap((g) => g.entries);
    expect(exportedEntries).toHaveLength(1);
    expect(exportedEntries[0].talkId).toBe(talkId);
    expect(exportedEntries[0].presentationId).toBeNull();
    expect(exportedEntries[0].lyricId).toBeNull();
    // The Talk item itself must be included in the bundle too — previously
    // `presentationId ?? lyricId` never surfaced its id, so it was dropped
    // both from the referenced-item set and from the filtered entry list.
    expect(manifest.items.some((item) => item.id === talkId)).toBe(true);

    const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-playlist-import-'));
    const importRepo = makeRepo(importDir);
    try {
      const inspection = importRepo.inspectImportBundle(manifest);
      expect(inspection.brokenReferences).toHaveLength(0);
      importRepo.finalizeImportBundle(manifest, []);

      const importedEntries = entriesFor(importRepo, 'Service');
      expect(importedEntries).toHaveLength(1);
      expect(importedEntries[0].item.type).toBe('talk');
      expect(importedEntries[0].item.title).toBe('Sermon');
      expect(importedEntries[0].entry.reference.type).toBe('talk');
      // Import mints new entry and item ids; content identity survives via title/type.
      expect(importedEntries[0].entry.id).not.toBe(exportedEntries[0].id);
      expect(importedEntries[0].item.id).not.toBe(talkId);
    } finally {
      closeRepo(importRepo);
      fs.rmSync(importDir, { recursive: true, force: true });
    }
  });

  it('rejects an import manifest playlist entry with zero populated owners, without partially importing it', () => {
    const manifest = buildMinimalTalkManifest();
    manifest.playlists![0].groups[0].entries[0] = {
      id: 'entry-1',
      presentationId: null,
      lyricId: null,
      talkId: null,
      order: 0,
    };

    expect(() => repo.inspectImportBundle(manifest)).toThrow(/missing an owner/);
    expect(() => repo.finalizeImportBundle(manifest, [])).toThrow(/missing an owner/);
    expect(repo.getSnapshot().libraryBundles).toHaveLength(0);
  });

  it('rejects an import manifest playlist entry with multiple populated owners, without partially importing it', () => {
    const manifest = buildMinimalTalkManifest();
    manifest.playlists![0].groups[0].entries[0] = {
      id: 'entry-1',
      presentationId: 'stray-presentation-id',
      lyricId: null,
      talkId: 'talk-1',
      order: 0,
    };

    expect(() => repo.inspectImportBundle(manifest)).toThrow(/multiple owners/);
    expect(() => repo.finalizeImportBundle(manifest, [])).toThrow(/multiple owners/);
    expect(repo.getSnapshot().libraryBundles).toHaveLength(0);
  });

  it('allows duplicate entries referencing the same item, each keeping its own entry identity', () => {
    const libraryId = createLibrary(repo, 'Library');
    const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
    const talkId = createDeckItem(repo, 'talk', 'Sermon');

    repo.addDeckItemToGroup(groupId, talkId);
    repo.addDeckItemToGroup(groupId, talkId);

    const entries: Array<{ entry: PlaylistEntry }> = entriesFor(repo, 'Service');
    expect(entries).toHaveLength(2);
    expect(entries[0].entry.id).not.toBe(entries[1].entry.id);
    expect(entries.every((e) => e.entry.reference.itemId === talkId)).toBe(true);
  });

  it('round-trips a full snapshot restore, preserving the Talk entry reference', () => {
    const libraryId = createLibrary(repo, 'Library');
    const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');
    const talkId = createDeckItem(repo, 'talk', 'Sermon');
    repo.addDeckItemToGroup(groupId, talkId);

    const snapshot = repo.getSnapshot();

    const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-playlist-restore-'));
    const restoreRepo = makeRepo(restoreDir);
    try {
      restoreRepo.restoreFromSnapshot(snapshot);
      const entries = entriesFor(restoreRepo, 'Service');
      expect(entries).toHaveLength(1);
      expect(entries[0].entry.reference).toEqual({ type: 'talk', itemId: talkId });
      expect(entries[0].entry.talkId).toBe(talkId);
    } finally {
      closeRepo(restoreRepo);
      fs.rmSync(restoreDir, { recursive: true, force: true });
    }
  });
});
