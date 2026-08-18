import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getSlideItemRef } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type { ItemRef, PlaylistRow } from '@lumacast/composition';
import { useCast } from './app-context';
import { itemRefKey, useProjectContent } from './use-project-content';
import { useThemeEditor } from './asset-editor/asset-editor-context';
import type { ItemCreateOptions, NavigationActionsValue, NavigationContextValue, NavigationStateValue } from '../types/navigation-context-types';
import {
  findCreatedId,
  findFirstPlaylistRowByItemRef,
  findPlaylistRowById,
  itemRefsEqual,
  resolveCurrentItemRef,
  resolveCurrentPlaylistRowId,
  resolvePinnedLyricItemRef,
} from '../utils/navigation-context-utils';

// #219 item-model refactor decision D9: no libraries, no `PlaylistTree`
// hierarchy — a playlist's rows come straight off the flat snapshot
// (`playlists` + `playlistEntries`), and selection is keyed on a typed
// `ItemRef` rather than a bare id drawn from a merged deck-item id space.

type ContentBrowseSource = 'playlist' | 'project';

const NavigationStateContext = createContext<NavigationStateValue | null>(null);
const NavigationActionsContext = createContext<NavigationActionsValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { snapshot, mutatePatch, runOperation, setStatusText } = useCast();
  const { presentationsById, lyricsById, talksById, slides, resolveItemRef } = useProjectContent();
  const { resolveThemeIdForMutation } = useThemeEditor();

  const [currentPlaylistId, setCurrentPlaylistIdState] = useState<Id | null>(null);
  const [currentPlaylistEntryId, setCurrentPlaylistEntryId] = useState<Id | null>(null);
  const [currentPlaylistItemRef, setCurrentPlaylistItemRef] = useState<ItemRef | null>(null);
  const [currentDrawerItemRef, setCurrentDrawerItemRef] = useState<ItemRef | null>(null);
  const [currentOutputPlaylistEntryId, setCurrentOutputPlaylistEntryId] = useState<Id | null>(null);
  const [currentOutputItemRef, setCurrentOutputItemRef] = useState<ItemRef | null>(null);
  const [deckBrowseSource, setContentBrowseSource] = useState<ContentBrowseSource>('playlist');
  const [outputArmVersion, setOutputArmVersion] = useState(0);
  const [recentlyCreatedId, setRecentlyCreatedId] = useState<Id | null>(null);
  // Holds in-flight create operations keyed by their resolved input so a
  // repeated invocation awaits the same promise instead of creating twice.
  const createItemPromiseRef = useRef(new Map<string, Promise<void>>());

  const itemExists = useCallback((ref: ItemRef): boolean => {
    if (ref.type === 'presentation') return presentationsById.has(ref.id);
    if (ref.type === 'lyric') return lyricsById.has(ref.id);
    return talksById.has(ref.id);
  }, [presentationsById, lyricsById, talksById]);

  const currentPlaylistRows = useMemo<PlaylistRow[]>(() => {
    if (!snapshot || !currentPlaylistId) return [];
    return snapshot.playlistEntries
      .filter((row) => row.playlistId === currentPlaylistId)
      .slice()
      .sort((left, right) => left.order - right.order);
  }, [snapshot, currentPlaylistId]);

  // Fresh-install / no-selection recovery: picks the first playlist and, once
  // one is selected, the first still-valid item reference for drawer/playlist
  // browsing — safely on an empty database (no playlists, no items yet).
  useEffect(() => {
    if (!snapshot) return;

    if (!currentPlaylistId || !snapshot.playlists.some((playlist) => playlist.id === currentPlaylistId)) {
      const firstPlaylistId = snapshot.playlists[0]?.id ?? null;
      if (firstPlaylistId !== currentPlaylistId) {
        setCurrentPlaylistIdState(firstPlaylistId);
      }
      return;
    }

    const rows = snapshot.playlistEntries
      .filter((row) => row.playlistId === currentPlaylistId)
      .slice()
      .sort((left, right) => left.order - right.order);

    const nextDrawerItemRef = resolveCurrentItemRef(currentDrawerItemRef, itemExists);
    if (!itemRefsEqual(nextDrawerItemRef, currentDrawerItemRef)) {
      setCurrentDrawerItemRef(nextDrawerItemRef);
    }

    const nextPlaylistItemRef = resolvePinnedLyricItemRef(currentPlaylistItemRef, rows, itemExists);
    const nextPlaylistEntryId = resolveCurrentPlaylistRowId(currentPlaylistEntryId, rows, nextPlaylistItemRef);
    if (nextPlaylistEntryId !== currentPlaylistEntryId) {
      setCurrentPlaylistEntryId(nextPlaylistEntryId);
    }
    if (!itemRefsEqual(nextPlaylistItemRef, currentPlaylistItemRef)) {
      setCurrentPlaylistItemRef(nextPlaylistItemRef);
    }

    if (currentOutputItemRef !== null) {
      const nextOutputItemRef = resolvePinnedLyricItemRef(currentOutputItemRef, rows, itemExists);
      if (!itemRefsEqual(nextOutputItemRef, currentOutputItemRef)) {
        setCurrentOutputItemRef(nextOutputItemRef);
      }
      const nextOutputEntryId = resolveCurrentPlaylistRowId(currentOutputPlaylistEntryId, rows, nextOutputItemRef);
      if (nextOutputEntryId !== currentOutputPlaylistEntryId) {
        setCurrentOutputPlaylistEntryId(nextOutputEntryId);
      }
    } else if (currentOutputPlaylistEntryId !== null) {
      setCurrentOutputPlaylistEntryId(null);
    }

    if (deckBrowseSource === 'project' && nextDrawerItemRef === null) {
      setContentBrowseSource('playlist');
    }
  }, [
    deckBrowseSource,
    itemExists,
    currentDrawerItemRef,
    currentOutputPlaylistEntryId,
    currentOutputItemRef,
    currentPlaylistEntryId,
    currentPlaylistItemRef,
    currentPlaylistId,
    snapshot,
  ]);

  const currentItemRef = useMemo(() => (
    deckBrowseSource === 'project' ? currentDrawerItemRef : currentPlaylistItemRef
  ), [deckBrowseSource, currentDrawerItemRef, currentPlaylistItemRef]);

  const currentItem = useMemo(() => resolveItemRef(currentItemRef), [resolveItemRef, currentItemRef]);
  const currentPlaylistItem = useMemo(() => resolveItemRef(currentPlaylistItemRef), [resolveItemRef, currentPlaylistItemRef]);

  const slideCountByItem = useMemo(() => {
    const counts = new Map<string, number>();
    for (const slide of slides) {
      const ref = getSlideItemRef(slide);
      if (!ref) continue;
      const key = itemRefKey(ref);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [slides]);

  const clearRecentlyCreated = useCallback(() => { setRecentlyCreatedId(null); }, []);

  const clearContentBrowser = useCallback(() => {
    setCurrentPlaylistEntryId(null);
    setCurrentPlaylistItemRef(null);
    setCurrentDrawerItemRef(null);
    setCurrentOutputPlaylistEntryId(null);
    setCurrentOutputItemRef(null);
    setContentBrowseSource('playlist');
  }, []);

  const setCurrentPlaylistId = useCallback((playlistId: Id | null) => {
    if (playlistId !== currentPlaylistId) {
      clearContentBrowser();
    }
    setCurrentPlaylistIdState(playlistId);
  }, [clearContentBrowser, currentPlaylistId]);

  const selectPlaylistEntry = useCallback((rowId: Id) => {
    const found = findPlaylistRowById(currentPlaylistRows, rowId);
    if (!found) return;
    setCurrentPlaylistEntryId(found.rowId);
    setCurrentPlaylistItemRef(found.itemRef);
    setContentBrowseSource('playlist');
    setStatusText('Opened item');
  }, [currentPlaylistRows, setStatusText]);

  const selectPlaylistItem = useCallback((itemRef: ItemRef) => {
    const found = findFirstPlaylistRowByItemRef(currentPlaylistRows, itemRef);
    setCurrentPlaylistEntryId(found?.rowId ?? null);
    setCurrentPlaylistItemRef(itemRef);
    setContentBrowseSource('playlist');
    setStatusText('Opened item');
  }, [currentPlaylistRows, setStatusText]);

  const browseItem = useCallback((itemRef: ItemRef) => {
    setCurrentDrawerItemRef(itemRef);
    setContentBrowseSource('project');
    setStatusText('Browsing item');
  }, [setStatusText]);

  const armOutputItem = useCallback((itemRef: ItemRef) => {
    const found = findFirstPlaylistRowByItemRef(currentPlaylistRows, itemRef);
    setCurrentOutputPlaylistEntryId(found?.rowId ?? null);
    setCurrentOutputItemRef(itemRef);
    setOutputArmVersion((current) => current + 1);
  }, [currentPlaylistRows]);

  const armOutputPlaylistEntry = useCallback((rowId: Id) => {
    const found = findPlaylistRowById(currentPlaylistRows, rowId);
    if (!found) return;
    setCurrentOutputPlaylistEntryId(found.rowId);
    setCurrentOutputItemRef(found.itemRef);
    setOutputArmVersion((current) => current + 1);
  }, [currentPlaylistRows]);

  const clearOutputItem = useCallback(() => {
    setCurrentOutputPlaylistEntryId(null);
    setCurrentOutputItemRef(null);
  }, []);

  const createPlaylist = useCallback(async () => {
    const previousIds = new Set(snapshot?.playlists.map((playlist) => playlist.id) ?? []);
    const next = await mutatePatch(() => window.castApi.createPlaylist('New Playlist'));
    setStatusText('Created playlist');
    const createdId = findCreatedId(previousIds, next.playlists.map((playlist) => playlist.id));
    if (createdId) {
      setCurrentPlaylistId(createdId);
      setRecentlyCreatedId(createdId);
    }
  }, [mutatePatch, setCurrentPlaylistId, setStatusText, snapshot]);

  // Atomic item creation used by both the legacy app-menu commands (File >
  // New Presentation/Lyric) and the create-item dialog: resolves any staged
  // theme first, then creates via the single `createItem` operation, which
  // returns the created id directly (never inferred by diffing arrays).
  const createItem = useCallback(async (input: ItemCreateOptions) => {
    const dedupeKey = JSON.stringify([input.type, input.name, input.themeId ?? null, input.playlistId ?? null, input.position ?? null]);
    const inFlight = createItemPromiseRef.current.get(dedupeKey);
    if (inFlight) return inFlight;

    const run = (async () => {
      const trimmedName = input.name.trim() || (input.type === 'lyric' ? 'New Lyric' : input.type === 'talk' ? 'New Talk' : 'New Presentation');
      const labelType = input.type === 'lyric' ? 'lyric' : input.type === 'talk' ? 'talk' : 'deck';

      await runOperation(`Creating ${labelType}...`, async () => {
        let resolvedThemeId: Id | null = null;
        if (input.themeId) {
          resolvedThemeId = await resolveThemeIdForMutation(input.themeId);
          if (!resolvedThemeId) {
            throw new Error('Failed to resolve theme. Theme persistence may have failed.');
          }
        }

        const result = await window.castApi.createItem({
          type: input.type,
          title: trimmedName,
          themeId: resolvedThemeId,
          playlistId: input.playlistId ?? null,
          position: input.position,
        });
        await mutatePatch(async () => result.patch);

        setCurrentDrawerItemRef({ type: input.type, id: result.itemId });
        setContentBrowseSource('project');
        setRecentlyCreatedId(result.itemId);
        setStatusText(`Created ${labelType}`);
      });
    })();

    createItemPromiseRef.current.set(dedupeKey, run);
    try {
      await run;
    } finally {
      createItemPromiseRef.current.delete(dedupeKey);
    }
  }, [mutatePatch, resolveThemeIdForMutation, runOperation, setStatusText]);

  const createPresentation = useCallback(async () => {
    await createItem({ type: 'presentation', name: 'New Presentation' });
  }, [createItem]);

  const createEmptyLyric = useCallback(async () => {
    await createItem({ type: 'lyric', name: 'New Lyric' });
  }, [createItem]);

  const createSeparator = useCallback(async () => {
    if (!currentPlaylistId) return;
    const previousIds = new Set(currentPlaylistRows.filter((row) => row.kind === 'separator').map((row) => row.id));
    const next = await mutatePatch(() => window.castApi.createSeparator(currentPlaylistId, 'New Separator'));
    setStatusText('Created separator');
    const nextIds = next.playlistEntries
      .filter((row) => row.playlistId === currentPlaylistId && row.kind === 'separator')
      .map((row) => row.id);
    const createdId = findCreatedId(previousIds, nextIds);
    if (createdId) setRecentlyCreatedId(createdId);
  }, [currentPlaylistId, currentPlaylistRows, mutatePatch, setStatusText]);

  const renameSeparator = useCallback(async (id: Id, label: string) => {
    await mutatePatch(() => window.castApi.renameSeparator(id, label));
    setStatusText(`Renamed separator: ${label}`);
  }, [mutatePatch, setStatusText]);

  const setSeparatorColor = useCallback(async (id: Id, colorKey: string | null) => {
    await mutatePatch(() => window.castApi.setSeparatorColor(id, colorKey));
    setStatusText('Updated separator color');
  }, [mutatePatch, setStatusText]);

  const addItemToPlaylist = useCallback(async (playlistId: Id, itemRef: ItemRef, position?: number): Promise<Id | null> => {
    const previousIds = new Set(
      snapshot?.playlistEntries.filter((row) => row.playlistId === playlistId).map((row) => row.id) ?? [],
    );
    const next = await mutatePatch(() => window.castApi.addItemToPlaylist(playlistId, itemRef, position));
    const nextIds = next.playlistEntries.filter((row) => row.playlistId === playlistId).map((row) => row.id);
    const createdId = findCreatedId(previousIds, nextIds);
    setStatusText('Added item to playlist');
    if (createdId && playlistId === currentPlaylistId) {
      setCurrentPlaylistEntryId(createdId);
      setCurrentPlaylistItemRef(itemRef);
      setContentBrowseSource('playlist');
    }
    return createdId;
  }, [currentPlaylistId, mutatePatch, setStatusText, snapshot]);

  const renamePlaylist = useCallback(async (id: Id, name: string) => {
    await mutatePatch(() => window.castApi.renamePlaylist(id, name));
    setStatusText(`Renamed playlist: ${name}`);
  }, [mutatePatch, setStatusText]);

  const reorderPlaylist = useCallback(async (playlistId: Id, newOrder: number) => {
    await mutatePatch(() => window.castApi.setPlaylistOrder(playlistId, newOrder));
    setStatusText('Reordered playlist');
  }, [mutatePatch, setStatusText]);

  const movePlaylistRow = useCallback(async (rowId: Id, newOrder: number) => {
    await mutatePatch(() => window.castApi.movePlaylistRow(rowId, newOrder));
    setStatusText('Moved item');
  }, [mutatePatch, setStatusText]);

  const removePlaylistRow = useCallback(async (rowId: Id) => {
    await mutatePatch(() => window.castApi.removePlaylistRow(rowId));
    setStatusText('Removed item from playlist');
  }, [mutatePatch, setStatusText]);

  const renameItem = useCallback(async (itemRef: ItemRef, title: string) => {
    if (itemRef.type === 'presentation') {
      await mutatePatch(() => window.castApi.renamePresentation(itemRef.id, title));
    } else if (itemRef.type === 'talk') {
      await mutatePatch(() => window.castApi.renameTalk(itemRef.id, title));
    } else {
      await mutatePatch(() => window.castApi.renameLyric(itemRef.id, title));
    }
    setStatusText(`Renamed item: ${title}`);
  }, [mutatePatch, setStatusText]);

  const deleteItem = useCallback(async (itemRef: ItemRef) => {
    if (itemRef.type === 'presentation') {
      await mutatePatch(() => window.castApi.deletePresentation(itemRef.id));
    } else if (itemRef.type === 'talk') {
      await mutatePatch(() => window.castApi.deleteTalk(itemRef.id));
    } else {
      await mutatePatch(() => window.castApi.deleteLyric(itemRef.id));
    }
    setStatusText('Deleted item');
  }, [mutatePatch, setStatusText]);

  const moveItem = useCallback(async (itemRef: ItemRef, direction: 'up' | 'down') => {
    if (itemRef.type === 'presentation') {
      await mutatePatch(() => window.castApi.movePresentation(itemRef.id, direction));
    } else if (itemRef.type === 'talk') {
      await mutatePatch(() => window.castApi.moveTalk(itemRef.id, direction));
    } else {
      await mutatePatch(() => window.castApi.moveLyric(itemRef.id, direction));
    }
    setStatusText(direction === 'up' ? 'Moved item up' : 'Moved item down');
  }, [mutatePatch, setStatusText]);

  const stateValue = useMemo<NavigationStateValue>(() => ({
    currentPlaylistId,
    currentPlaylistRows,
    currentPlaylistEntryId,
    currentItemRef,
    currentPlaylistItemRef,
    currentDrawerItemRef,
    currentOutputPlaylistEntryId,
    currentOutputItemRef,
    currentItem,
    currentPlaylistItem,
    isDetachedDeckBrowser: deckBrowseSource === 'project',
    outputArmVersion,
    slideCountByItem,
    recentlyCreatedId,
  }), [
    currentDrawerItemRef,
    currentItem,
    currentItemRef,
    currentOutputItemRef,
    currentOutputPlaylistEntryId,
    currentPlaylistEntryId,
    currentPlaylistId,
    currentPlaylistItem,
    currentPlaylistItemRef,
    currentPlaylistRows,
    deckBrowseSource,
    outputArmVersion,
    recentlyCreatedId,
    slideCountByItem,
  ]);

  const actionsValue = useMemo<NavigationActionsValue>(() => ({
    selectPlaylistEntry,
    selectPlaylistItem,
    browseItem,
    armOutputPlaylistEntry,
    armOutputItem,
    clearOutputItem,
    setCurrentPlaylistId,
    clearRecentlyCreated,
    createPlaylist,
    createPresentation,
    createEmptyLyric,
    createItem,
    createSeparator,
    renameSeparator,
    setSeparatorColor,
    addItemToPlaylist,
    renamePlaylist,
    renameItem,
    deleteItem,
    moveItem,
    reorderPlaylist,
    movePlaylistRow,
    removePlaylistRow,
  }), [
    addItemToPlaylist,
    armOutputItem,
    armOutputPlaylistEntry,
    browseItem,
    clearOutputItem,
    clearRecentlyCreated,
    createEmptyLyric,
    createItem,
    createPlaylist,
    createPresentation,
    createSeparator,
    deleteItem,
    moveItem,
    movePlaylistRow,
    removePlaylistRow,
    renameItem,
    renamePlaylist,
    renameSeparator,
    reorderPlaylist,
    selectPlaylistEntry,
    selectPlaylistItem,
    setCurrentPlaylistId,
    setSeparatorColor,
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
