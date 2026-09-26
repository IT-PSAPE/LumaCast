import { useCallback, useState } from 'react';
import type { Id } from '@lumacast/kernel';

export function useIndexedSelection() {
  const [indices, setIndices] = useState<Record<Id, number>>({});

  const update = useCallback((itemId: Id, nextIndex: number) => {
    setIndices((current) => ({
      ...current,
      [itemId]: nextIndex,
    }));
  }, []);

  return { indices, update } as const;
}
