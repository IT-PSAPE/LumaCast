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

function getSegmentEntryIds(snapshot: AppSnapshot | null | undefined, segmentId: Id): Id[] {
  for (const bundle of snapshot?.libraryBundles ?? []) {
    for (const playlist of bundle.playlists) {
      const segment = playlist.segments.find((entry) => entry.segment.id === segmentId);
      if (segment) return segment.entries.map((entry) => entry.entry.id);
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

  const renameSegment = useCallback(async (id: Id, name: string) => {
    await mutatePatch(() => window.castApi.renamePlaylistSegment(id, name));
    setStatusText(`Renamed segment: ${name}`);
  }, [mutatePatch, setStatusText]);

  const setSegmentColor = useCallback(async (id: Id, colorKey: string | null) => {
    const setColorApi = (window.castApi as { setPlaylistSegmentColor?: (segmentId: Id, nextColorKey: string | null) => Promise<SnapshotPatch> }).setPlaylistSegmentColor;
    if (!setColorApi) {
      setStatusText('Restart required: segment color API is not loaded');
      return;
    }

    try {
      await mutatePatch(() => setColorApi(id, colorKey));
      setStatusText(colorKey ? 'Updated segment color' : 'Removed segment color');
    } catch {
      setStatusText('Failed to update segment color');
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

  const deleteSegment = useCallback(async (id: Id) => {
    await mutatePatch(() => window.castApi.deletePlaylistSegment(id));
    setStatusText('Deleted segment');
  }, [mutatePatch, setStatusText]);

  const deleteDeckItem = useCallback(async (id: Id) => {
    const itemType = resolveDeckItemType(id);
    if (!itemType) return;
    await mutatePatch(() => itemType === 'presentation'
      ? window.castApi.deletePresentation(id)
      : window.castApi.deleteLyric(id));
    setStatusText('Deleted item');
  }, [mutatePatch, setStatusText, snapshot]);

  const moveDeckItemToSegment = useCallback(async (playlistId: Id, itemId: Id, segmentId: Id | null) => {
    await mutatePatch(() => window.castApi.moveDeckItemToSegment(playlistId, itemId, segmentId));
    setStatusText(segmentId ? 'Moved item to segment' : 'Removed item from playlist');
  }, [mutatePatch, setStatusText]);

  const movePlaylistEntryToSegment = useCallback(async (entryId: Id, segmentId: Id | null) => {
    await mutatePatch(() => window.castApi.movePlaylistEntryToSegment(entryId, segmentId));
    setStatusText(segmentId ? 'Moved item to segment' : 'Removed item from playlist');
  }, [mutatePatch, setStatusText]);

  const movePlaylist = useCallback(async (id: Id, direction: 'up' | 'down') => {
    await mutatePatch(() => window.castApi.movePlaylist(id, direction));
    setStatusText(direction === 'up' ? 'Moved playlist up' : 'Moved playlist down');
  }, [mutatePatch, setStatusText]);

  const movePlaylistSegment = useCallback(async (id: Id, currentOrder: number, direction: 'up' | 'down') => {
    const newOrder = direction === 'up' ? currentOrder - 1 : currentOrder + 1;
    await mutatePatch(() => window.castApi.setPlaylistSegmentOrder(id, newOrder));
    setStatusText(direction === 'up' ? 'Moved segment up' : 'Moved segment down');
  }, [mutatePatch, setStatusText]);

  const moveDeckItem = useCallback(async (id: Id, direction: 'up' | 'down') => {
    await mutatePatch(() => window.castApi.moveDeckItem(id, direction));
    setStatusText(direction === 'up' ? 'Moved item up' : 'Moved item down');
  }, [mutatePatch, setStatusText]);

  const movePlaylistEntry = useCallback(async (entryId: Id, direction: 'up' | 'down') => {
    await mutate(() => window.castApi.movePlaylistEntry(entryId, direction));
    setStatusText(direction === 'up' ? 'Moved entry up' : 'Moved entry down');
  }, [mutate, setStatusText]);

  const addDeckItemToSegment = useCallback(async (segmentId: Id, itemId: Id) => {
    const previousEntryIds = new Set(getSegmentEntryIds(snapshot, segmentId));
    const nextSnapshot = await mutatePatch(() => window.castApi.addDeckItemToSegment(segmentId, itemId));
    setStatusText('Added item to segment');
    return findCreatedId(previousEntryIds, getSegmentEntryIds(nextSnapshot, segmentId));
  }, [mutatePatch, setStatusText, snapshot]);

  const createDeckItemEntryInSegment = useCallback(async (
    segmentId: Id,
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
    await addDeckItemToSegment(segmentId, createdItemId);
    setStatusText(statusText);
    return createdItemId;
  }, [addDeckItemToSegment, snapshot, mutatePatch, setStatusText]);

  const createPresentationInSegment = useCallback(async (_libraryId: Id, segmentId: Id) => {
    return createDeckItemEntryInSegment(
      segmentId,
      () => window.castApi.createPresentation('New Presentation'),
      (itemId) => window.castApi.createSlide({ presentationId: itemId }),
      'Created deck and added to segment'
    );
  }, [createDeckItemEntryInSegment]);

  const createLyricInSegment = useCallback(async (_libraryId: Id, segmentId: Id) => {
    return createDeckItemEntryInSegment(
      segmentId,
      () => window.castApi.createLyric('New Lyric'),
      (itemId) => window.castApi.createSlide({ lyricId: itemId }),
      'Created lyric and added to segment'
    );
  }, [createDeckItemEntryInSegment]);

  return {
    renameLibrary,
    renamePlaylist,
    renameSegment,
    setSegmentColor,
    renameDeckItem,
    deleteLibrary,
    deletePlaylist,
    deleteSegment,
    deleteDeckItem,
    moveDeckItemToSegment,
    movePlaylistEntryToSegment,
    movePlaylist,
    movePlaylistSegment,
    moveDeckItem,
    movePlaylistEntry,
    addDeckItemToSegment,
    createPresentationInSegment,
    createLyricInSegment
  };
}
