import { useCallback, useSyncExternalStore } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface BinSort<Key extends string> {
  key: Key;
  direction: SortDirection;
}

const VALID_DIRECTIONS: SortDirection[] = ['asc', 'desc'];

interface BinSortConfig<Key extends string> {
  storageKey: string;
  defaultSort: BinSort<Key>;
  validKeys: readonly Key[];
}

export function createBinSortHook<Key extends string>(config: BinSortConfig<Key>) {
  const { storageKey, defaultSort, validKeys } = config;
  const validKeySet = new Set<string>(validKeys);

  function isValid(value: unknown): value is BinSort<Key> {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    return typeof record.key === 'string'
      && validKeySet.has(record.key)
      && VALID_DIRECTIONS.includes(record.direction as SortDirection);
  }

  function readFromStorage(): BinSort<Key> {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return defaultSort;
      const parsed = JSON.parse(raw);
      return isValid(parsed) ? parsed : defaultSort;
    } catch {
      return defaultSort;
    }
  }

  let sortState: BinSort<Key> = readFromStorage();
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  function subscribe(callback: () => void) {
    listeners.add(callback);
    return () => { listeners.delete(callback); };
  }

  return function useBinSort() {
    const sort = useSyncExternalStore(subscribe, () => sortState, () => sortState);

    const setSort = useCallback((next: BinSort<Key>) => {
      sortState = next;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore storage errors; in-memory state still updates
      }
      emit();
    }, []);

    return { sort, setSort };
  };
}

export type BinTabSortKey = 'name' | 'created' | 'modified';
export type DeckBinSortKey = BinTabSortKey | 'slides';

export const useDeckBinSort = createBinSortHook<DeckBinSortKey>({
  storageKey: 'lumacast.deck-bin-sort',
  defaultSort: { key: 'modified', direction: 'desc' },
  validKeys: ['name', 'created', 'modified', 'slides'],
});

export const useMediaBinSort = createBinSortHook<BinTabSortKey>({
  storageKey: 'lumacast.media-bin-sort',
  defaultSort: { key: 'modified', direction: 'desc' },
  validKeys: ['name', 'created', 'modified'],
});

export const useAudioBinSort = createBinSortHook<BinTabSortKey>({
  storageKey: 'lumacast.audio-bin-sort',
  defaultSort: { key: 'modified', direction: 'desc' },
  validKeys: ['name', 'created', 'modified'],
});

export const useThemeBinSort = createBinSortHook<BinTabSortKey>({
  storageKey: 'lumacast.theme-bin-sort',
  defaultSort: { key: 'modified', direction: 'desc' },
  validKeys: ['name', 'created', 'modified'],
});

export function compareByKey<T extends { createdAt: string; updatedAt: string }>(
  a: T,
  b: T,
  key: BinTabSortKey,
  labelOf: (item: T) => string,
): number {
  switch (key) {
    case 'name':
      return labelOf(a).localeCompare(labelOf(b));
    case 'created':
      return a.createdAt.localeCompare(b.createdAt);
    case 'modified':
      return a.updatedAt.localeCompare(b.updatedAt);
  }
}
