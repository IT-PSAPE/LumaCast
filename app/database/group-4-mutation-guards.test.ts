import { describe, expect, it } from 'vitest';
import type { Id, PlaylistTree, SlideElementPayload } from '@core/types';
import type { CastRepository } from './store';
import { createTestRepository } from './test-support';

// Covers #214's group 4: the mutation methods that never checked existence
// at all. `deleteCue`, `deleteMacro`, `deleteStage`, `deleteLibrary`,
// `renamePlaylistGroup`, `renameLibrary`, `renamePlaylist`,
// `renamePresentation`, `renameLyric`, and `renameTalk` ran their
// UPDATE/DELETE and returned a patch claiming success even when zero rows
// matched. `updateElementsBatch` silently dropped unresolvable ids from the
// batch (`if (!existing) continue;`) with no signal in the returned patch.
// Every method now throws for an unresolvable id; because the batch loop
// runs inside a transaction, `updateElementsBatch` is all-or-nothing — one
// bad id rolls the whole batch back, leaving even the resolvable inputs
// unmodified (pinned below).

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

const textPayload: SlideElementPayload = {
  text: 'Guard test element',
  fontFamily: 'Avenir Next',
  fontSize: 48,
  color: '#FFFFFF',
  alignment: 'left',
  weight: '400',
};

function makeElement(id: string, zIndex = 1) {
  const now = new Date().toISOString();
  return {
    id,
    slideId: '',
    type: 'text' as const,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    rotation: 0,
    opacity: 1,
    zIndex,
    layer: 'content' as const,
    payload: textPayload,
    createdAt: now,
    updatedAt: now,
  };
}

// A themed deck item's slide elements are reachable through the public
// snapshot, giving the batch tests real element ids to mutate.
function createDeckItemWithElements(repo: CastRepository, elementCount: number): { itemId: Id; elementIds: Id[] } {
  const themePatch = repo.createTheme({
    name: 'Theme',
    kind: 'slides',
    elements: Array.from({ length: elementCount }, (_, i) => makeElement(`el-${i}`, i + 1)),
  });
  const theme = themePatch.upserts.themes?.[0];
  if (!theme) throw new Error('createTheme returned no theme');
  const { itemId } = repo.createDeckItemWithFirstSlide({ type: 'presentation', title: 'Deck', themeId: theme.id });
  const snapshot = repo.getSnapshot();
  const slide = snapshot.slides.find((s) => s.presentationId === itemId);
  if (!slide) throw new Error('created deck item has no slide');
  const elementIds = snapshot.slideElements.filter((element) => element.slideId === slide.id).map((element) => element.id);
  if (elementIds.length !== elementCount) throw new Error(`expected ${elementCount} slide elements, got ${elementIds.length}`);
  return { itemId, elementIds };
}

function elementById(repo: CastRepository, id: Id) {
  const element = repo.getSnapshot().slideElements.find((e) => e.id === id);
  if (!element) throw new Error(`slide element not found in snapshot: ${id}`);
  return element;
}

describe('CastRepository.deleteCue (#214)', () => {
  it('throws for an unresolvable cue id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.deleteCue('no-such-cue'))
        .toThrow(/Cue not found: no-such-cue/);
    } finally {
      close();
      cleanup();
    }
  });

  it('deletes an existing cue without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const created = repo.createCue({ kind: 'overlay.clearAll', payload: {} });
      const cueId = created.upserts.cues?.[0]?.id;
      if (!cueId) throw new Error('createCue returned no cue');

      const patch = repo.deleteCue(cueId);
      expect(patch.deletes.cues).toContain(cueId);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an id that was already deleted, distinguishing failure from no-change', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const created = repo.createCue({ kind: 'overlay.clearAll', payload: {} });
      const cueId = created.upserts.cues?.[0]?.id;
      if (!cueId) throw new Error('createCue returned no cue');
      repo.deleteCue(cueId);
      expect(() => repo.deleteCue(cueId)).toThrow(/Cue not found: /);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.deleteMacro (#214)', () => {
  it('throws for an unresolvable macro id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.deleteMacro('no-such-macro'))
        .toThrow(/Macro not found: no-such-macro/);
    } finally {
      close();
      cleanup();
    }
  });

  it('deletes an existing macro without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const patch = repo.createMacro({ name: 'Macro', description: '', cues: [] });
      const macroId = patch.upserts.macros?.[0]?.id;
      if (!macroId) throw new Error('createMacro returned no macro');

      const deletePatch = repo.deleteMacro(macroId);
      expect(deletePatch.deletes.macros).toContain(macroId);
    } finally {
      close();
      cleanup();
    }
  });

  it('throws for an id that was already deleted, distinguishing failure from no-change', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const patch = repo.createMacro({ name: 'Macro', description: '', cues: [] });
      const macroId = patch.upserts.macros?.[0]?.id;
      if (!macroId) throw new Error('createMacro returned no macro');
      repo.deleteMacro(macroId);
      expect(() => repo.deleteMacro(macroId)).toThrow(/Macro not found: /);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.deleteStage (#214)', () => {
  it('throws for an unresolvable stage id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.deleteStage('no-such-stage'))
        .toThrow(/Stage not found: no-such-stage/);
    } finally {
      close();
      cleanup();
    }
  });

  it('deletes an existing stage without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const patch = repo.createStage({ name: 'Stage' });
      const stageId = patch.upserts.stages?.[0]?.id;
      if (!stageId) throw new Error('createStage returned no stage');

      const deletePatch = repo.deleteStage(stageId);
      expect(deletePatch.deletes.stages).toContain(stageId);
      expect(repo.getSnapshot().stages.some((stage) => stage.id === stageId)).toBe(false);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.deleteLibrary (#214)', () => {
  it('throws for an unresolvable library id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.deleteLibrary('no-such-library'))
        .toThrow(/Library not found: no-such-library/);
    } finally {
      close();
      cleanup();
    }
  });

  it('deletes an existing library and its playlists without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      repo.createPlaylist(libraryId, 'Service');

      const deletePatch = repo.deleteLibrary(libraryId);
      expect(deletePatch.deletes.libraries).toContain(libraryId);
      expect(repo.getSnapshot().libraries.some((library) => library.id === libraryId)).toBe(false);
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.renamePlaylistGroup (#214)', () => {
  it('throws for an unresolvable group id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.renamePlaylistGroup('no-such-group', 'Renamed'))
        .toThrow(/Group not found: no-such-group/);
    } finally {
      close();
      cleanup();
    }
  });

  it('renames an existing group without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const { groupId } = createPlaylistWithGroup(repo, libraryId, 'Service', 'Opening');

      repo.renamePlaylistGroup(groupId, 'Renamed');

      const tree = findPlaylistTree(repo, 'Service');
      expect(tree.groups.find((g) => g.group.id === groupId)?.group.name).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.renameLibrary (#214)', () => {
  it('throws for an unresolvable library id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.renameLibrary('no-such-library', 'Renamed'))
        .toThrow(/Library not found: no-such-library/);
    } finally {
      close();
      cleanup();
    }
  });

  it('renames an existing library without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      const patch = repo.renameLibrary(libraryId, 'Renamed');
      expect(patch.upserts.libraries?.[0]?.name).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.renamePlaylist (#214)', () => {
  it('throws for an unresolvable playlist id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.renamePlaylist('no-such-playlist', 'Renamed'))
        .toThrow(/Playlist not found: no-such-playlist/);
    } finally {
      close();
      cleanup();
    }
  });

  it('renames an existing playlist without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const libraryId = createLibrary(repo, 'Library');
      repo.createPlaylist(libraryId, 'Service');
      const tree = findPlaylistTree(repo, 'Service');

      repo.renamePlaylist(tree.playlist.id, 'Renamed');

      expect(findPlaylistTree(repo, 'Renamed').playlist.name).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.renamePresentation / renameLyric / renameTalk (#214)', () => {
  it('throws for an unresolvable deck item id', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      expect(() => repo.renamePresentation('no-such-item', 'Renamed'))
        .toThrow(/Deck item not found: no-such-item/);
      expect(() => repo.renameLyric('no-such-item', 'Renamed'))
        .toThrow(/Deck item not found: no-such-item/);
      expect(() => repo.renameTalk('no-such-item', 'Renamed'))
        .toThrow(/Deck item not found: no-such-item/);
    } finally {
      close();
      cleanup();
    }
  });

  it('renames an existing presentation without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const presentationId = createDeckItem(repo, 'presentation', 'Deck');
      const patch = repo.renamePresentation(presentationId, 'Renamed');
      expect(patch.upserts.presentations?.[0]?.title).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });

  it('renames an existing lyric without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const lyricId = createDeckItem(repo, 'lyric', 'Song');
      const patch = repo.renameLyric(lyricId, 'Renamed');
      expect(patch.upserts.lyrics?.[0]?.title).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });

  it('renames an existing talk without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const talkId = createDeckItem(repo, 'talk', 'Sermon');
      const patch = repo.renameTalk(talkId, 'Renamed');
      expect(patch.upserts.talks?.[0]?.title).toBe('Renamed');
    } finally {
      close();
      cleanup();
    }
  });
});

describe('CastRepository.updateElementsBatch (#214)', () => {
  it('throws for a batch containing an unresolvable element id and changes nothing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const { elementIds } = createDeckItemWithElements(repo, 2);
      const [firstId, secondId] = elementIds;

      expect(() => repo.updateElementsBatch([
        { id: firstId, x: 777 },
        { id: 'no-such-element', x: 1 },
        { id: secondId, y: 444 },
      ])).toThrow(/Slide element not found: no-such-element/);

      // All-or-nothing: the resolvable inputs were rolled back with the bad
      // one, so neither element changed.
      expect(elementById(repo, firstId).x).toBe(0);
      expect(elementById(repo, secondId).y).toBe(0);
    } finally {
      close();
      cleanup();
    }
  });

  it('updates every element of an all-resolvable batch without throwing', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const { elementIds } = createDeckItemWithElements(repo, 2);
      const [firstId, secondId] = elementIds;

      const patch = repo.updateElementsBatch([
        { id: firstId, x: 111 },
        { id: secondId, y: 222 },
      ]);

      // The patch carries both updated elements. Compare as a set: the rows come
      // back from getSlideElementsByIds in SQL order, which is independent of the
      // order the ids were passed in.
      expect(patch.upserts.slideElements?.map((element) => element.id).sort())
        .toEqual([firstId, secondId].sort());
      expect(elementById(repo, firstId).x).toBe(111);
      expect(elementById(repo, secondId).y).toBe(222);
    } finally {
      close();
      cleanup();
    }
  });

  it('returns an empty patch for an empty batch', () => {
    const { repository: repo, close, cleanup } = createTestRepository();
    try {
      const patch = repo.updateElementsBatch([]);
      expect(patch.upserts.slideElements).toBeUndefined();
    } finally {
      close();
      cleanup();
    }
  });
});