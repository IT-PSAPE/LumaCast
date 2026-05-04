import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Collection, CollectionBinKind, Id, CollectionItemType } from '@core/types';
import { useCast } from '../../contexts/app-context';
import { useProjectContent } from '../../contexts/use-project-content';

const STORAGE_KEY_PREFIX = 'lumacast.bin.activeCollection.';
const ALL_COLLECTIONS_SENTINEL = '__all__';
const NO_SELECTION = '__unset__';

function readPersistedActive(binKind: CollectionBinKind): Id | null | typeof NO_SELECTION {
  try {
    const value = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${binKind}`);
    if (value === null) return NO_SELECTION;
    return value === ALL_COLLECTIONS_SENTINEL ? null : value;
  } catch {
    return NO_SELECTION;
  }
}

function writePersistedActive(binKind: CollectionBinKind, id: Id | null): void {
  try {
    if (id) {
      window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${binKind}`, id);
      return;
    }
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${binKind}`, ALL_COLLECTIONS_SENTINEL);
  } catch {
    // ignore
  }
}

export interface BinCollectionsApi {
  collections: Collection[];
  activeCollection: Collection | null;
  setActiveCollectionId: (id: Id | null) => void;
  filterByActiveCollection: <T extends { collectionId: Id }>(items: T[]) => T[];
  createCollection: (name: string) => Promise<Id | null>;
  renameCollection: (id: Id, name: string) => Promise<void>;
  deleteCollection: (id: Id) => Promise<void>;
  reorderCollections: (ids: Id[]) => Promise<void>;
  assignItem: (itemType: CollectionItemType, itemId: Id, collectionId: Id) => Promise<void>;
}

export function useBinCollections(binKind: CollectionBinKind): BinCollectionsApi {
  const { mutatePatch, setStatusText } = useCast();
  const { collectionsByBinKind } = useProjectContent();
  const collections = useMemo(() => collectionsByBinKind.get(binKind) ?? [], [collectionsByBinKind, binKind]);

  const [activeId, setActiveId] = useState<Id | null | typeof NO_SELECTION>(() => readPersistedActive(binKind));

  useEffect(() => {
    if (activeId === NO_SELECTION) {
      if (collections.length === 0) return;
      const fallback = collections.find((c) => c.isDefault) ?? collections[0] ?? null;
      const fallbackId = fallback?.id ?? null;
      setActiveId(fallbackId);
      writePersistedActive(binKind, fallbackId);
      return;
    }
    if (activeId && !collections.some((collection) => collection.id === activeId)) {
      setActiveId(null);
      writePersistedActive(binKind, null);
    }
  }, [activeId, collections, binKind]);

  const activeCollection = useMemo(
    () => activeId && activeId !== NO_SELECTION ? (collections.find((c) => c.id === activeId) ?? null) : null,
    [collections, activeId],
  );

  const setActiveCollectionId = useCallback((id: Id | null) => {
    setActiveId(id);
    writePersistedActive(binKind, id);
  }, [binKind]);

  const filterByActiveCollection = useCallback(<T extends { collectionId: Id }>(items: T[]): T[] => {
    if (!activeId) return items;
    return items.filter((item) => item.collectionId === activeId);
  }, [activeId]);

  const createCollection = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    try {
      const next = await mutatePatch(() => window.castApi.createCollection({ binKind, name: trimmed }));
      setStatusText(`Created collection ${trimmed}`);
      const created = next.collections.find((c) => c.binKind === binKind && c.name === trimmed && !c.isDefault);
      if (created) {
        setActiveId(created.id);
        writePersistedActive(binKind, created.id);
        return created.id;
      }
      return null;
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Failed to create collection');
      throw error;
    }
  }, [binKind, mutatePatch, setStatusText]);

  const renameCollection = useCallback(async (id: Id, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await mutatePatch(() => window.castApi.renameCollection({ binKind, id, name: trimmed }));
      setStatusText(`Renamed collection`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Failed to rename collection');
      throw error;
    }
  }, [binKind, mutatePatch, setStatusText]);

  const deleteCollection = useCallback(async (id: Id) => {
    await mutatePatch(() => window.castApi.deleteCollection({ binKind, id }));
    if (activeId === id) {
      const fallback = collections.find((c) => c.isDefault) ?? null;
      const fallbackId = fallback?.id ?? null;
      setActiveId(fallbackId);
      writePersistedActive(binKind, fallbackId);
    }
    setStatusText('Deleted collection');
  }, [binKind, mutatePatch, setStatusText, activeId, collections]);

  const reorderCollections = useCallback(async (ids: Id[]) => {
    await mutatePatch(() => window.castApi.reorderCollections({ binKind, ids }));
  }, [binKind, mutatePatch]);

  const assignItem = useCallback(async (itemType: CollectionItemType, itemId: Id, collectionId: Id) => {
    await mutatePatch(() => window.castApi.setItemCollection({ itemType, itemId, collectionId }));
    setStatusText('Moved item');
  }, [mutatePatch, setStatusText]);

  return {
    collections,
    activeCollection,
    setActiveCollectionId,
    filterByActiveCollection,
    createCollection,
    renameCollection,
    deleteCollection,
    reorderCollections,
    assignItem,
  };
}
