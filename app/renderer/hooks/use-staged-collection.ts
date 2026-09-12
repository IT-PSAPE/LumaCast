import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Id } from '@lumacast/kernel';
import type { WorkbenchMode } from '../types/ui';
import { collectionSignature } from '../utils/staged-editor-utils';

interface StagedCollectionConfig<T extends { id: Id }> {
  persistedItems: T[];
  signatureOf: (item: T) => string;
  workbenchModeKey: WorkbenchMode;
  currentWorkbenchMode: WorkbenchMode;
}

interface StagedCollectionResult<T extends { id: Id }> {
  items: T[];
  stagedItems: T[] | null;
  currentItemId: Id | null;
  currentItem: T | null;
  hasPendingChanges: boolean;
  isPushingChanges: boolean;
  setCurrentItemId: React.Dispatch<React.SetStateAction<Id | null>>;
  setStagedItems: React.Dispatch<React.SetStateAction<T[] | null>>;
  setIsPushingChanges: (value: boolean) => void;
  registerAutoPush: (fn: () => void) => void;
}

export function useStagedCollection<T extends { id: Id }>({
  persistedItems,
  signatureOf,
  workbenchModeKey,
  currentWorkbenchMode,
}: StagedCollectionConfig<T>): StagedCollectionResult<T> {
  const [stagedItems, setStagedItems] = useState<T[] | null>(null);
  const [currentItemId, setCurrentItemId] = useState<Id | null>(null);
  const [isPushingChanges, setIsPushingChanges] = useState(false);
  const previousWorkbenchModeRef = useRef(currentWorkbenchMode);
  const autoPushRef = useRef<(() => void) | null>(null);

  const items = useMemo(() => stagedItems ?? persistedItems, [stagedItems, persistedItems]);

  const hasPendingChanges = useMemo(() => {
    if (!stagedItems) return false;
    return collectionSignature(stagedItems, signatureOf) !== collectionSignature(persistedItems, signatureOf);
  }, [persistedItems, signatureOf, stagedItems]);

  useEffect(() => {
    if (items.length === 0) {
      setCurrentItemId(null);
      return;
    }
    if (!currentItemId || !items.some((item) => item.id === currentItemId)) {
      setCurrentItemId(items[0]?.id ?? null);
    }
  }, [currentItemId, items]);

  const currentItem = useMemo(
    () => items.find((item) => item.id === currentItemId) ?? null,
    [currentItemId, items],
  );

  const registerAutoPush = useCallback((fn: () => void) => {
    autoPushRef.current = fn;
  }, []);

  useEffect(() => {
    const previousWorkbenchMode = previousWorkbenchModeRef.current;
    previousWorkbenchModeRef.current = currentWorkbenchMode;
    if (previousWorkbenchMode !== workbenchModeKey || currentWorkbenchMode === workbenchModeKey) return;
    if (!hasPendingChanges || isPushingChanges) return;
    autoPushRef.current?.();
  }, [currentWorkbenchMode, hasPendingChanges, isPushingChanges, workbenchModeKey]);

  return {
    items,
    stagedItems,
    currentItemId,
    currentItem,
    hasPendingChanges,
    isPushingChanges,
    setCurrentItemId,
    setStagedItems,
    setIsPushingChanges,
    registerAutoPush,
  };
}
