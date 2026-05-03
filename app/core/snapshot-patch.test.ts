import { describe, expect, it } from 'vitest';
import { applyPatch, invertPatch, type SnapshotPatch } from './snapshot-patch';
import type { AppSnapshot, Library, LibraryPlaylistBundle, Presentation } from './types';

function buildSnapshot(): AppSnapshot {
  const library: Library = {
    id: 'library-1',
    name: 'Library',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const presentation: Presentation = {
    id: 'presentation-1',
    title: 'Presentation',
    type: 'presentation',
    collectionId: 'deck-default',
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const libraryBundle: LibraryPlaylistBundle = {
    library,
    playlists: [],
  };

  return {
    libraries: [library],
    libraryBundles: [libraryBundle],
    presentations: [presentation],
    lyrics: [],
    slides: [],
    slideElements: [],
    mediaAssets: [],
    overlays: [],
    themes: [],
    stages: [],
    collections: [],
  };
}

describe('invertPatch', () => {
  it('reverses create, update, delete, and derived bundle replacement', () => {
    const snapshot = buildSnapshot();
    const nextLibrary: Library = { ...snapshot.libraries[0], name: 'Renamed library', updatedAt: '2026-01-02T00:00:00.000Z' };
    const createdPresentation: Presentation = {
      id: 'presentation-2',
      title: 'Created',
      type: 'presentation',
      collectionId: 'deck-default',
      order: 1,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const patch: SnapshotPatch = {
      version: 7,
      upserts: {
        libraries: [nextLibrary],
        presentations: [createdPresentation],
        libraryBundles: [{ library: nextLibrary, playlists: [] }],
      },
      deletes: {
        presentations: ['presentation-1'],
      },
    };

    const next = applyPatch(snapshot, patch);
    const inverse = invertPatch(snapshot, patch);
    const restored = applyPatch(next, inverse);

    expect(restored).toEqual(snapshot);
  });
});
