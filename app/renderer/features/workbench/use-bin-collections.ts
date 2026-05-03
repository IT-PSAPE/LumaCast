import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Collection, CollectionBinKind, Id, CollectionItemType } from '@core/types';
import { useCast } from '../../contexts/app-context';
import { useProjectContent } from '../../contexts/use-project-content';

const STORAGE_KEY_PREFIX = 'lumacast.bin.activeCollection.';

function readPersistedActive(binKind: CollectionBinKind): Id | null {
  try {
    return window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${binKind}`);
  } catch {
    return null;
  }
}

function writePersistedActive(binKind: CollectionBinKind, id: Id | null): void {
  try {
    if (id) window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${binKind}`, id);
    else window.localStorage.removeItem(`${STORAGE_KEY_PREFIX}${binKind}`);
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

  const [activeId, setActiveId] = useState<Id | null>(() => readPersistedActive(binKind));

  useEffect(() => {
    if (activeId && !collections.some((collection) => collection.id === activeId)) {
      // Stored selection no longer exists — fall back to the default collection.
      const fallback = collections.find((c) => c.isDefault) ?? collections[0] ?? null;
      const fallbackId = fallback?.id ?? null;
      setActiveId(fallbackId);
      writePersistedActive(binKind, fallbackId);
    }
    if (!activeId && collections.length > 0) {
      const fallback = collections.find((c) => c.isDefault) ?? collections[0];
      setActiveId(fallback.id);
      writePersistedActive(binKind, fallback.id);
    }
  }, [activeId, collections, binKind]);

  const activeCollection = useMemo(
    () => collections.find((c) => c.id === activeId) ?? null,
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
      setStatusText(`Failed to create collection`);
      throw error;
    }
  }, [binKind, mutatePatch, setStatusText]);

  const renameCollection = useCallback(async (id: Id, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await mutatePatch(() => window.castApi.renameCollection({ binKind, id, name: trimmed }));
    setStatusText(`Renamed collection`);
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
