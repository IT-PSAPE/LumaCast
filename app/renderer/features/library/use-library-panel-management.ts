import { useCallback } from 'react';
import type { Id } from '@lumacast/kernel';
import type { DeckItemType } from '@lumacast/composition';
import type { AppSnapshot } from '@lumacast/protocol';
import { useCast } from '../../contexts/app-context';

function findCreatedId(previousIds: Set<Id>, currentIds: Id[]): Id | null {
  for (const id of currentIds) {
    if (!previousIds.has(id)) return id;
  }
  return null;
}

function getGroupEntryIds(snapshot: AppSnapshot | null | undefined, groupId: Id): Id[] {
  for (const bundle of snapshot?.libraryBundles ?? []) {
    for (const playlist of bundle.playlists) {
      const group = playlist.groups.find((entry) => entry.group.id === groupId);
      if (group) return group.entries.map((entry) => entry.entry.id);
    }
  }

  return [];
}

export function useLibraryPanelManagement() {
  const { snapshot, mutatePatch, setStatusText } = useCast();

  function resolveDeckItemType(itemId: Id): DeckItemType | null {
    if (snapshot?.presentations.some((item) => item.id === itemId)) return 'presentation';
    if (snapshot?.lyrics.some((item) => item.id === itemId)) return 'lyric';
    if (snapshot?.talks.some((item) => item.id === itemId)) return 'talk';
    return null;
  }

  const renameLibrary = useCallback(async (id: Id, name: string) => {
    await mutatePatch(() => window.castApi.renameLibrary(id, name));
    setStatusText(`Renamed library: ${name}`);
  }, [mutatePatch, setStatusText]);

  const renamePlaylist = useCallback(async (id: Id, name: string) => {
    await mutatePatch(() => window.castApi.renamePlaylist(id, name));
    setStatusText(`Renamed playlist: ${name}`);
  }, [mutatePatch, setStatusText]);

  const renameGroup = useCallback(async (id: Id, name: string) => {
    await mutatePatch(() => window.castApi.renamePlaylistGroup(id, name));
    setStatusText(`Renamed group: ${name}`);
  }, [mutatePatch, setStatusText]);

  const setGroupColor = useCallback(async (id: Id, colorKey: string | null) => {
    try {
      await mutatePatch(() => window.castApi.setPlaylistGroupColor(id, colorKey));
      setStatusText(colorKey ? 'Updated group color' : 'Removed group color');
    } catch {
      setStatusText('Failed to update group color');
    }
  }, [mutatePatch, setStatusText]);

  const renameDeckItem = useCallback(async (id: Id, title: string) => {
    const itemType = resolveDeckItemType(id);
    if (!itemType) return;
    await mutatePatch(() => itemType === 'presentation'
      ? window.castApi.renamePresentation(id, title)
      : itemType === 'talk'
        ? window.castApi.renameTalk(id, title)
        : window.castApi.renameLyric(id, title));
    setStatusText(`Renamed item: ${title}`);
  }, [mutatePatch, setStatusText, snapshot]);

  const deleteLibrary = useCallback(async (id: Id) => {
    await mutatePatch(() => window.castApi.deleteLibrary(id));
    setStatusText('Deleted library');
  }, [mutatePatch, setStatusText]);

  const deletePlaylist = useCallback(async (id: Id) => {
    await mutatePatch(() => window.castApi.deletePlaylist(id));
    setStatusText('Deleted playlist');
  }, [mutatePatch, setStatusText]);

  const deleteGroup = useCallback(async (id: Id) => {
    await mutatePatch(() => window.castApi.deletePlaylistGroup(id));
    setStatusText('Deleted group');
  }, [mutatePatch, setStatusText]);

  const deleteDeckItem = useCallback(async (id: Id) => {
    const itemType = resolveDeckItemType(id);
    if (!itemType) return;
    await mutatePatch(() => itemType === 'presentation'
      ? window.castApi.deletePresentation(id)
      : itemType === 'talk'
        ? window.castApi.deleteTalk(id)
        : window.castApi.deleteLyric(id));
    setStatusText('Deleted item');
  }, [mutatePatch, setStatusText, snapshot]);

  const moveDeckItemToGroup = useCallback(async (playlistId: Id, itemId: Id, groupId: Id | null) => {
    await mutatePatch(() => window.castApi.moveDeckItemToGroup(playlistId, itemId, groupId));
    setStatusText(groupId ? 'Moved item to group' : 'Removed item from playlist');
  }, [mutatePatch, setStatusText]);

  const movePlaylistEntryToGroup = useCallback(async (entryId: Id, groupId: Id | null) => {
    await mutatePatch(() => window.castApi.movePlaylistEntryToGroup(entryId, groupId));
    setStatusText(groupId ? 'Moved item to group' : 'Removed item from playlist');
  }, [mutatePatch, setStatusText]);

  const movePlaylist = useCallback(async (id: Id, direction: 'up' | 'down') => {
    await mutatePatch(() => window.castApi.movePlaylist(id, direction));
    setStatusText(direction === 'up' ? 'Moved playlist up' : 'Moved playlist down');
  }, [mutatePatch, setStatusText]);

  const movePlaylistGroup = useCallback(async (id: Id, currentOrder: number, direction: 'up' | 'down') => {
    const newOrder = direction === 'up' ? currentOrder - 1 : currentOrder + 1;
    await mutatePatch(() => window.castApi.setPlaylistGroupOrder(id, newOrder));
    setStatusText(direction === 'up' ? 'Moved group up' : 'Moved group down');
  }, [mutatePatch, setStatusText]);

  const moveDeckItem = useCallback(async (id: Id, direction: 'up' | 'down') => {
    await mutatePatch(() => window.castApi.moveDeckItem(id, direction));
    setStatusText(direction === 'up' ? 'Moved item up' : 'Moved item down');
  }, [mutatePatch, setStatusText]);

  const movePlaylistEntry = useCallback(async (entryId: Id, direction: 'up' | 'down') => {
    await mutatePatch(() => window.castApi.movePlaylistEntry(entryId, direction));
    setStatusText(direction === 'up' ? 'Moved entry up' : 'Moved entry down');
  }, [mutatePatch, setStatusText]);

  const addDeckItemToGroup = useCallback(async (playlistId: Id, groupId: Id, itemId: Id) => {
    const previousEntryIds = new Set(getGroupEntryIds(snapshot, groupId));
    const nextSnapshot = await mutatePatch(() => window.castApi.addDeckItemToGroup(playlistId, groupId, itemId));
    setStatusText('Added item to group');
    return findCreatedId(previousEntryIds, getGroupEntryIds(nextSnapshot, groupId));
  }, [mutatePatch, setStatusText, snapshot]);

  // Library/group creation routes through the same atomic
  // createDeckItemWithTheme operation as the create dialog and app menu, with
  // explicit nulls for collection/theme and the target group id passed
  // directly so owner, first slide, and playlist-entry membership commit in
  // one transaction — no separate create-then-slide-then-add sequence.
  const createDeckItemInGroup = useCallback(async (
    type: DeckItemType,
    groupId: Id,
    title: string,
    statusText: string,
  ) => {
    const result = await window.castApi.createDeckItemWithTheme({
      type,
      title,
      collectionId: null,
      themeId: null,
      groupId,
    });
    await mutatePatch(async () => result.patch);
    setStatusText(statusText);
    return result.itemId;
  }, [mutatePatch, setStatusText]);

  const createPresentationInGroup = useCallback(async (_libraryId: Id, groupId: Id) => (
    createDeckItemInGroup('presentation', groupId, 'New Presentation', 'Created deck and added to group')
  ), [createDeckItemInGroup]);

  const createLyricInGroup = useCallback(async (_libraryId: Id, groupId: Id) => (
    createDeckItemInGroup('lyric', groupId, 'New Lyric', 'Created lyric and added to group')
  ), [createDeckItemInGroup]);

  const createTalkInGroup = useCallback(async (_libraryId: Id, groupId: Id) => (
    createDeckItemInGroup('talk', groupId, 'New Talk', 'Created talk and added to group')
  ), [createDeckItemInGroup]);

  return {
    renameLibrary,
    renamePlaylist,
    renameGroup,
    setGroupColor,
    renameDeckItem,
    deleteLibrary,
    deletePlaylist,
    deleteGroup,
    deleteDeckItem,
    moveDeckItemToGroup,
    movePlaylistEntryToGroup,
    movePlaylist,
    movePlaylistGroup,
    moveDeckItem,
    movePlaylistEntry,
    addDeckItemToGroup,
    createPresentationInGroup,
    createLyricInGroup,
    createTalkInGroup
  };
}
