import { useCallback } from 'react';
import type { AppSnapshot, DeckItemType, Id } from '@core/types';
import type { SnapshotPatch } from '@core/snapshot-patch';
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
  const { snapshot, mutate, mutatePatch, setStatusText } = useCast();

  function getDeckItems(nextSnapshot: AppSnapshot | null | undefined) {
    return [...(nextSnapshot?.presentations ?? []), ...(nextSnapshot?.lyrics ?? [])];
  }

  function resolveDeckItemType(itemId: Id): DeckItemType | null {
    if (snapshot?.presentations.some((item) => item.id === itemId)) return 'presentation';
    if (snapshot?.lyrics.some((item) => item.id === itemId)) return 'lyric';
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
    await mutate(() => window.castApi.movePlaylistEntry(entryId, direction));
    setStatusText(direction === 'up' ? 'Moved entry up' : 'Moved entry down');
  }, [mutate, setStatusText]);

  const addDeckItemToGroup = useCallback(async (groupId: Id, itemId: Id) => {
    const previousEntryIds = new Set(getGroupEntryIds(snapshot, groupId));
    const nextSnapshot = await mutatePatch(() => window.castApi.addDeckItemToGroup(groupId, itemId));
    setStatusText('Added item to group');
    return findCreatedId(previousEntryIds, getGroupEntryIds(nextSnapshot, groupId));
  }, [mutatePatch, setStatusText, snapshot]);

  const createDeckItemEntryInGroup = useCallback(async (
    groupId: Id,
    createEntry: () => Promise<SnapshotPatch>,
    createSlide: (itemId: Id) => Promise<SnapshotPatch>,
    statusText: string,
  ) => {
    const previousItemIds = new Set(getDeckItems(snapshot).map((item) => item.id));
    const next = await mutatePatch(createEntry);
    const nextItems = getDeckItems(next);
    const createdItemId = findCreatedId(previousItemIds, nextItems.map((item) => item.id))
      ?? nextItems.at(-1)?.id
      ?? null;
    if (!createdItemId) return null;

    await mutatePatch(() => createSlide(createdItemId));
    await addDeckItemToGroup(groupId, createdItemId);
    setStatusText(statusText);
    return createdItemId;
  }, [addDeckItemToGroup, snapshot, mutatePatch, setStatusText]);

  const createPresentationInGroup = useCallback(async (_libraryId: Id, groupId: Id) => {
    return createDeckItemEntryInGroup(
      groupId,
      () => window.castApi.createPresentation('New Presentation'),
      (itemId) => window.castApi.createSlide({ presentationId: itemId }),
      'Created deck and added to group'
    );
  }, [createDeckItemEntryInGroup]);

  const createLyricInGroup = useCallback(async (_libraryId: Id, groupId: Id) => {
    return createDeckItemEntryInGroup(
      groupId,
      () => window.castApi.createLyric('New Lyric'),
      (itemId) => window.castApi.createSlide({ lyricId: itemId }),
      'Created lyric and added to group'
    );
  }, [createDeckItemEntryInGroup]);

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
    createLyricInGroup
  };
}
