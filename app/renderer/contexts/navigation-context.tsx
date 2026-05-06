import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSlideDeckItemId } from '@core/deck-items';
import type { Id, LibraryPlaylistBundle } from '@core/types';
import { useCast } from './app-context';
import { useProjectContent } from './use-project-content';
import type { NavigationActionsValue, NavigationContextValue, NavigationStateValue } from '../types/navigation-context-types';
import { findCreatedId, findFirstPlaylistEntryByDeckItemId, findPlaylistEntryById, resolveCurrentDeckItemId, resolveCurrentPlaylistEntryId, resolvePinnedLyricDeckItemId } from '../utils/navigation-context-utils';

type ContentBrowseSource = 'playlist' | 'project';

function getGroupEntryIds(snapshot: { libraryBundles: LibraryPlaylistBundle[] } | null | undefined, groupId: Id): Id[] {
  for (const bundle of snapshot?.libraryBundles ?? []) {
    for (const playlist of bundle.playlists) {
      const group = playlist.groups.find((entry) => entry.group.id === groupId);
      if (group) return group.entries.map((entry) => entry.entry.id);
    }
  }

  return [];
}

const NavigationStateContext = createContext<NavigationStateValue | null>(null);
const NavigationActionsContext = createContext<NavigationActionsValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { snapshot, mutate, mutatePatch, runOperation, setStatusText } = useCast();
  const { deckItems, deckItemsById, slides } = useProjectContent();

  const [currentLibraryId, setCurrentLibraryId] = useState<Id | null>(null);
  const [currentPlaylistId, setCurrentPlaylistIdState] = useState<Id | null>(null);
  const [currentPlaylistEntryId, setCurrentPlaylistEntryId] = useState<Id | null>(null);
  const [currentPlaylistDeckItemId, setCurrentPlaylistDeckItemId] = useState<Id | null>(null);
  const [currentDrawerDeckItemId, setCurrentDrawerDeckItemId] = useState<Id | null>(null);
  const [currentOutputPlaylistEntryId, setCurrentOutputPlaylistEntryId] = useState<Id | null>(null);
  const [currentOutputDeckItemId, setCurrentOutputDeckItemId] = useState<Id | null>(null);
  const [deckBrowseSource, setContentBrowseSource] = useState<ContentBrowseSource>('playlist');
  const [outputArmVersion, setOutputArmVersion] = useState(0);
  const [recentlyCreatedId, setRecentlyCreatedId] = useState<Id | null>(null);

  useEffect(() => {
    if (!snapshot || snapshot.libraries.length === 0) return;
    if (!currentLibraryId || !snapshot.libraries.some((library) => library.id === currentLibraryId)) {
      setCurrentLibraryId(snapshot.libraries[0].id);
      return;
    }

    const bundle = snapshot.libraryBundles.find((entry) => entry.library.id === currentLibraryId);
    if (!bundle) return;

    const nextPlaylistId = (!currentPlaylistId || !bundle.playlists.some((tree) => tree.playlist.id === currentPlaylistId))
      ? bundle.playlists[0]?.playlist.id ?? null
      : currentPlaylistId;
    if (nextPlaylistId !== currentPlaylistId) {
      setCurrentPlaylistIdState(nextPlaylistId);
    }

    const selectedTree = nextPlaylistId
      ? bundle.playlists.find((tree) => tree.playlist.id === nextPlaylistId) ?? null
      : null;

    const nextDrawerDeckItemId = resolveCurrentDeckItemId(
      currentDrawerDeckItemId,
      deckItems.map((item) => item.id),
    );
    if (nextDrawerDeckItemId !== currentDrawerDeckItemId) {
      setCurrentDrawerDeckItemId(nextDrawerDeckItemId);
    }

    const nextPlaylistDeckItemId = resolvePinnedLyricDeckItemId(
      currentPlaylistDeckItemId,
      selectedTree,
      deckItemsById,
    );
    const nextPlaylistEntryId = resolveCurrentPlaylistEntryId(
      currentPlaylistEntryId,
      selectedTree,
      nextPlaylistDeckItemId,
    );
    if (nextPlaylistEntryId !== currentPlaylistEntryId) {
      setCurrentPlaylistEntryId(nextPlaylistEntryId);
    }
    if (nextPlaylistDeckItemId !== currentPlaylistDeckItemId) {
      setCurrentPlaylistDeckItemId(nextPlaylistDeckItemId);
    }

    if (currentOutputDeckItemId !== null) {
      const nextOutputDeckItemId = resolvePinnedLyricDeckItemId(
        currentOutputDeckItemId,
        selectedTree,
        deckItemsById,
      );
      if (nextOutputDeckItemId !== currentOutputDeckItemId) {
        setCurrentOutputDeckItemId(nextOutputDeckItemId);
      }
      const nextOutputEntryId = resolveCurrentPlaylistEntryId(
        currentOutputPlaylistEntryId,
        selectedTree,
        nextOutputDeckItemId,
      );
      if (nextOutputEntryId !== currentOutputPlaylistEntryId) {
        setCurrentOutputPlaylistEntryId(nextOutputEntryId);
      }
    } else if (currentOutputPlaylistEntryId !== null) {
      setCurrentOutputPlaylistEntryId(null);
    }

    if (deckBrowseSource === 'project' && nextDrawerDeckItemId === null) {
      setContentBrowseSource('playlist');
    }
  }, [
    deckBrowseSource,
    deckItems,
    deckItemsById,
    currentDrawerDeckItemId,
    currentLibraryId,
    currentOutputPlaylistEntryId,
    currentOutputDeckItemId,
    currentPlaylistEntryId,
    currentPlaylistDeckItemId,
    currentPlaylistId,
    snapshot,
  ]);

  const currentDeckItemId = useMemo(() => (
    deckBrowseSource === 'project' ? currentDrawerDeckItemId : currentPlaylistDeckItemId
  ), [deckBrowseSource, currentDrawerDeckItemId, currentPlaylistDeckItemId]);

  const currentLibraryBundle = useMemo<LibraryPlaylistBundle | null>(
    () => (!snapshot || !currentLibraryId ? null : snapshot.libraryBundles.find((bundle) => bundle.library.id === currentLibraryId) ?? null),
    [currentLibraryId, snapshot],
  );

  const currentDeckItem = useMemo(
    () => (currentDeckItemId ? deckItemsById.get(currentDeckItemId) ?? null : null),
    [deckItemsById, currentDeckItemId],
  );

  const currentPlaylistDeckItem = useMemo(
    () => (currentPlaylistDeckItemId ? deckItemsById.get(currentPlaylistDeckItemId) ?? null : null),
    [deckItemsById, currentPlaylistDeckItemId],
  );

  const slideCountByDeckItem = useMemo(() => {
    const counts = new Map<Id, number>();
    for (const slide of slides) {
      const itemId = getSlideDeckItemId(slide);
      if (!itemId) continue;
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }
    return counts;
  }, [slides]);

  const clearRecentlyCreated = useCallback(() => { setRecentlyCreatedId(null); }, []);

  const clearContentBrowser = useCallback(() => {
    setCurrentPlaylistEntryId(null);
    setCurrentPlaylistDeckItemId(null);
    setCurrentDrawerDeckItemId(null);
    setCurrentOutputPlaylistEntryId(null);
    setCurrentOutputDeckItemId(null);
    setContentBrowseSource('playlist');
  }, []);

  const selectLibrary = useCallback((libraryId: Id) => {
    if (!snapshot) return;
    const bundle = snapshot.libraryBundles.find((entry) => entry.library.id === libraryId);
    if (!bundle) return;
    if (libraryId !== currentLibraryId) {
      clearContentBrowser();
    }
    setCurrentLibraryId(libraryId);
    setCurrentPlaylistIdState(bundle.playlists[0]?.playlist.id ?? null);
    setStatusText(`Switched to ${bundle.library.name}`);
  }, [clearContentBrowser, currentLibraryId, setStatusText, snapshot]);

  const setCurrentPlaylistId = useCallback((playlistId: Id | null) => {
    if (playlistId !== currentPlaylistId) {
      clearContentBrowser();
    }
    setCurrentPlaylistIdState(playlistId);
  }, [clearContentBrowser, currentPlaylistId]);

  const selectPlaylistEntry = useCallback((entryId: Id) => {
    const entry = findPlaylistEntryById(
      currentLibraryBundle?.playlists.find((tree) => tree.playlist.id === currentPlaylistId) ?? null,
      entryId,
    );
    if (!entry) return;
    setCurrentPlaylistEntryId(entry.entryId);
    setCurrentPlaylistDeckItemId(entry.itemId);
    setContentBrowseSource('playlist');
    setStatusText('Opened item');
  }, [currentLibraryBundle, currentPlaylistId, setStatusText]);

  const selectPlaylistDeckItem = useCallback((itemId: Id) => {
    const entry = findFirstPlaylistEntryByDeckItemId(
      currentLibraryBundle?.playlists.find((tree) => tree.playlist.id === currentPlaylistId) ?? null,
      itemId,
    );
    setCurrentPlaylistEntryId(entry?.entryId ?? null);
    setCurrentPlaylistDeckItemId(itemId);
    setContentBrowseSource('playlist');
    setStatusText('Opened item');
  }, [currentLibraryBundle, currentPlaylistId, setStatusText]);

  const browseDeckItem = useCallback((itemId: Id) => {
    setCurrentDrawerDeckItemId(itemId);
    setContentBrowseSource('project');
    setStatusText('Browsing item');
  }, [setStatusText]);

  const armOutputDeckItem = useCallback((itemId: Id) => {
    const entry = findFirstPlaylistEntryByDeckItemId(
      currentLibraryBundle?.playlists.find((tree) => tree.playlist.id === currentPlaylistId) ?? null,
      itemId,
    );
    setCurrentOutputPlaylistEntryId(entry?.entryId ?? null);
    setCurrentOutputDeckItemId(itemId);
    setOutputArmVersion((current) => current + 1);
  }, [currentLibraryBundle, currentPlaylistId]);

  const armOutputPlaylistEntry = useCallback((entryId: Id) => {
    const entry = findPlaylistEntryById(
      currentLibraryBundle?.playlists.find((tree) => tree.playlist.id === currentPlaylistId) ?? null,
      entryId,
    );
    if (!entry) return;
    setCurrentOutputPlaylistEntryId(entry.entryId);
    setCurrentOutputDeckItemId(entry.itemId);
    setOutputArmVersion((current) => current + 1);
  }, [currentLibraryBundle, currentPlaylistId]);

  const clearOutputDeckItem = useCallback(() => {
    setCurrentOutputPlaylistEntryId(null);
    setCurrentOutputDeckItemId(null);
  }, []);

  const createLibrary = useCallback(async () => {
    const previousIds = new Set(snapshot?.libraries.map((library) => library.id) ?? []);
    const next = await mutatePatch(() => window.castApi.createLibrary('New Library'));
    setStatusText('Created library');
    const createdId = findCreatedId(previousIds, next.libraries.map((library) => library.id));
    if (createdId) setRecentlyCreatedId(createdId);
  }, [mutatePatch, setStatusText, snapshot]);

  const createPlaylist = useCallback(async () => {
    if (!currentLibraryId) return;
    const previousIds = new Set(currentLibraryBundle?.playlists.map((tree) => tree.playlist.id) ?? []);
    const next = await mutatePatch(() => window.castApi.createPlaylist(currentLibraryId, 'New Playlist'));
    setStatusText('Created playlist');
    const updatedBundle = next.libraryBundles.find((bundle) => bundle.library.id === currentLibraryId);
    const createdId = findCreatedId(previousIds, updatedBundle?.playlists.map((tree) => tree.playlist.id) ?? []);
    if (createdId) {
      setCurrentPlaylistId(createdId);
      setRecentlyCreatedId(createdId);
    }
  }, [currentLibraryBundle, currentLibraryId, mutatePatch, setCurrentPlaylistId, setStatusText]);

  const createPresentation = useCallback(async () => {
    await runOperation('Creating deck...', async () => {
      const previousIds = new Set(deckItems.map((item) => item.id));
      const next = await mutatePatch(() => window.castApi.createPresentation('New Presentation'));
      const createdId = findCreatedId(previousIds, [...next.presentations, ...next.lyrics].map((item) => item.id));
      if (!createdId) return;
      await mutatePatch(() => window.castApi.createSlide({ presentationId: createdId }));
      setCurrentDrawerDeckItemId(createdId);
      setContentBrowseSource('project');
      setRecentlyCreatedId(createdId);
      setStatusText('Created deck');
    });
  }, [deckItems, mutatePatch, runOperation, setStatusText]);

  const createEmptyLyric = useCallback(async () => {
    await runOperation('Creating lyric...', async () => {
      const previousIds = new Set(deckItems.map((item) => item.id));
      const next = await mutatePatch(() => window.castApi.createLyric('New Lyric'));
      const createdId = findCreatedId(previousIds, [...next.presentations, ...next.lyrics].map((item) => item.id));
      if (!createdId) return;
      await mutatePatch(() => window.castApi.createSlide({ lyricId: createdId }));
      setCurrentDrawerDeckItemId(createdId);
      setContentBrowseSource('project');
      setRecentlyCreatedId(createdId);
      setStatusText('Created lyric');
    });
  }, [deckItems, mutatePatch, runOperation, setStatusText]);

  // Granular create flow used by the create-deck-item dialog. Creates the deck item
  // with a chosen name, then optionally applies a theme and adds it to a group
  // — all atomic from the user's perspective (one click of the dialog's New button).
  const createDeckItem = useCallback(async (input: {
    kind: 'presentation' | 'lyric';
    name: string;
    themeId?: Id;
    groupId?: Id;
  }) => {
    const trimmedName = input.name.trim() || (input.kind === 'lyric' ? 'New Lyric' : 'New Presentation');
    const labelKind = input.kind === 'lyric' ? 'lyric' : 'deck';

    await runOperation(`Creating ${labelKind}...`, async () => {
      const previousIds = new Set(deckItems.map((item) => item.id));
      const next = input.kind === 'lyric'
        ? await mutatePatch(() => window.castApi.createLyric(trimmedName))
        : await mutatePatch(() => window.castApi.createPresentation(trimmedName));
      const createdId = findCreatedId(previousIds, [...next.presentations, ...next.lyrics].map((item) => item.id));
      if (!createdId) return;

      await mutatePatch(() => (
        input.kind === 'lyric'
          ? window.castApi.createSlide({ lyricId: createdId })
          : window.castApi.createSlide({ presentationId: createdId })
      ));

      if (input.themeId) {
        await mutatePatch(() => window.castApi.applyThemeToDeckItem(input.themeId!, createdId));
      }

      if (input.groupId) {
        await mutatePatch(() => window.castApi.addDeckItemToGroup(input.groupId!, createdId));
      }

      setCurrentDrawerDeckItemId(createdId);
      setContentBrowseSource('project');
      setRecentlyCreatedId(createdId);
      setStatusText(`Created ${labelKind}`);
    });
  }, [deckItems, mutatePatch, runOperation, setStatusText]);

  const createGroup = useCallback(async () => {
    if (!currentPlaylistId) return;
    const currentTree = currentLibraryBundle?.playlists.find((tree) => tree.playlist.id === currentPlaylistId);
    const previousIds = new Set(currentTree?.groups.map((group) => group.group.id) ?? []);
    const next = await mutatePatch(() => window.castApi.createPlaylistGroup(currentPlaylistId, 'New Group'));
    setStatusText('Created group');
    const updatedBundle = next.libraryBundles.find((bundle) => bundle.library.id === currentLibraryId);
    const updatedTree = updatedBundle?.playlists.find((tree) => tree.playlist.id === currentPlaylistId);
    const createdId = findCreatedId(previousIds, updatedTree?.groups.map((group) => group.group.id) ?? []);
    if (createdId) setRecentlyCreatedId(createdId);
  }, [currentLibraryBundle, currentLibraryId, currentPlaylistId, mutatePatch, setStatusText]);

  const addDeckItemToGroup = useCallback(async (groupId: Id) => {
    if (!currentDeckItemId || !currentPlaylistId) return;
    await mutatePatch(() => window.castApi.addDeckItemToGroup(groupId, currentDeckItemId));
    setStatusText('Added item to group');
  }, [currentDeckItemId, currentPlaylistId, mutatePatch, setStatusText]);

  const addDeckItemToGroupAt = useCallback(async (groupId: Id, itemId: Id, newOrder: number) => {
    if (!currentPlaylistId || !deckItemsById.has(itemId)) return null;

    const previousEntryIds = new Set(getGroupEntryIds(snapshot, groupId));
    const afterAdd = await mutatePatch(() => window.castApi.addDeckItemToGroup(groupId, itemId));
    const createdEntryId = findCreatedId(previousEntryIds, getGroupEntryIds(afterAdd, groupId));
    if (!createdEntryId) {
      setStatusText('Added item to group');
      return null;
    }

    await mutatePatch(() => window.castApi.movePlaylistEntryTo(createdEntryId, groupId, newOrder));
    setCurrentPlaylistEntryId(createdEntryId);
    setCurrentPlaylistDeckItemId(itemId);
    setContentBrowseSource('playlist');
    setStatusText('Added item to group');
    return createdEntryId;
  }, [currentPlaylistId, deckItemsById, mutatePatch, setStatusText, snapshot]);

  const moveCurrentDeckItemToGroup = useCallback(async (groupId: Id | null) => {
    if (!currentDeckItemId || !currentPlaylistId) return;
    await mutatePatch(() => window.castApi.moveDeckItemToGroup(currentPlaylistId, currentDeckItemId, groupId));
    setStatusText(groupId ? 'Moved item to group' : 'Removed item from playlist');
  }, [currentDeckItemId, currentPlaylistId, mutatePatch, setStatusText]);

  const renameLibrary = useCallback(async (id: Id, name: string) => {
    await mutatePatch(() => window.castApi.renameLibrary(id, name));
    setStatusText(`Renamed library: ${name}`);
  }, [mutatePatch, setStatusText]);

  const reorderLibrary = useCallback(async (libraryId: Id, newOrder: number) => {
    await mutatePatch(() => window.castApi.setLibraryOrder(libraryId, newOrder));
    setStatusText('Reordered library');
  }, [mutatePatch, setStatusText]);

  const reorderPlaylist = useCallback(async (playlistId: Id, newOrder: number) => {
    await mutatePatch(() => window.castApi.setPlaylistOrder(playlistId, newOrder));
    setStatusText('Reordered playlist');
  }, [mutatePatch, setStatusText]);

  const reorderGroup = useCallback(async (groupId: Id, newOrder: number) => {
    await mutatePatch(() => window.castApi.setPlaylistGroupOrder(groupId, newOrder));
    setStatusText('Reordered group');
  }, [mutatePatch, setStatusText]);

  const movePlaylistEntry = useCallback(async (entryId: Id, groupId: Id, newOrder: number) => {
    await mutatePatch(() => window.castApi.movePlaylistEntryTo(entryId, groupId, newOrder));
    setStatusText('Moved item');
  }, [mutatePatch, setStatusText]);

  const movePlaylistEntryDirection = useCallback(async (entryId: Id, direction: 'up' | 'down') => {
    await mutate(() => window.castApi.movePlaylistEntry(entryId, direction));
    setStatusText(direction === 'up' ? 'Moved item up' : 'Moved item down');
  }, [mutate, setStatusText]);

  const removePlaylistEntry = useCallback(async (entryId: Id) => {
    await mutatePatch(() => window.castApi.movePlaylistEntryToGroup(entryId, null));
    setStatusText('Removed item from group');
  }, [mutatePatch, setStatusText]);

  const renamePlaylist = useCallback(async (id: Id, name: string) => {
    await mutatePatch(() => window.castApi.renamePlaylist(id, name));
    setStatusText(`Renamed playlist: ${name}`);
  }, [mutatePatch, setStatusText]);

  const renameDeckItem = useCallback(async (id: Id, title: string) => {
    const item = deckItemsById.get(id);
    if (!item) return;
    if (item.type === 'presentation') {
      await mutatePatch(() => window.castApi.renamePresentation(id, title));
    } else {
      await mutatePatch(() => window.castApi.renameLyric(id, title));
    }
    setStatusText(`Renamed item: ${title}`);
  }, [deckItemsById, mutatePatch, setStatusText]);

  const stateValue = useMemo<NavigationStateValue>(() => ({
    currentLibraryId,
    currentPlaylistId,
    currentPlaylistEntryId,
    currentDeckItemId,
    currentPlaylistDeckItemId,
    currentDrawerDeckItemId,
    currentOutputPlaylistEntryId,
    currentOutputDeckItemId,
    currentLibraryBundle,
    currentDeckItem,
    currentPlaylistDeckItem,
    isDetachedDeckBrowser: deckBrowseSource === 'project',
    outputArmVersion,
    slideCountByDeckItem,
    recentlyCreatedId,
  }), [
    deckBrowseSource,
    currentDeckItem,
    currentDeckItemId,
    currentDrawerDeckItemId,
    currentLibraryBundle,
    currentLibraryId,
    currentOutputPlaylistEntryId,
    currentOutputDeckItemId,
    currentPlaylistDeckItem,
    currentPlaylistEntryId,
    currentPlaylistDeckItemId,
    currentPlaylistId,
    outputArmVersion,
    recentlyCreatedId,
    slideCountByDeckItem,
  ]);

  const actionsValue = useMemo<NavigationActionsValue>(() => ({
    selectLibrary,
    selectPlaylistEntry,
    selectPlaylistDeckItem,
    browseDeckItem,
    armOutputPlaylistEntry,
    armOutputDeckItem,
    clearOutputDeckItem,
    setCurrentPlaylistId,
    clearRecentlyCreated,
    createLibrary,
    createPlaylist,
    createPresentation,
    createEmptyLyric,
    createDeckItem,
    createGroup,
    addDeckItemToGroup,
    addDeckItemToGroupAt,
    moveCurrentDeckItemToGroup,
    renameLibrary,
    renamePlaylist,
    renameDeckItem,
    reorderLibrary,
    reorderPlaylist,
    reorderGroup,
    movePlaylistEntry,
    movePlaylistEntryDirection,
    removePlaylistEntry,
  }), [
    addDeckItemToGroup,
    addDeckItemToGroupAt,
    armOutputPlaylistEntry,
    armOutputDeckItem,
    browseDeckItem,
    clearOutputDeckItem,
    clearRecentlyCreated,
    createPresentation,
    createEmptyLyric,
    createDeckItem,
    createLibrary,
    createPlaylist,
    createGroup,
    moveCurrentDeckItemToGroup,
    renameDeckItem,
    renameLibrary,
    renamePlaylist,
    reorderLibrary,
    reorderPlaylist,
    reorderGroup,
    movePlaylistEntry,
    movePlaylistEntryDirection,
    removePlaylistEntry,
    selectLibrary,
    selectPlaylistEntry,
    selectPlaylistDeckItem,
    setCurrentPlaylistId,
  ]);

  return (
    <NavigationStateContext.Provider value={stateValue}>
      <NavigationActionsContext.Provider value={actionsValue}>
        {children}
      </NavigationActionsContext.Provider>
    </NavigationStateContext.Provider>
  );
}

export function useNavigationState(): NavigationStateValue {
  const context = useContext(NavigationStateContext);
  if (!context) throw new Error('useNavigationState must be used within NavigationProvider');
  return context;
}
export function useNavigationActions(): NavigationActionsValue {
  const context = useContext(NavigationActionsContext);
  if (!context) throw new Error('useNavigationActions must be used within NavigationProvider');
  return context;
}
export function useNavigation(): NavigationContextValue {
  const state = useNavigationState();
  const actions = useNavigationActions();
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
