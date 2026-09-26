import { useCallback } from 'react';
import { clamp } from '../utils/math';
import { useLocalStorage } from './use-local-storage';

export function useGridSize(storageKey: string, defaultValue: number, min: number, max: number, step: number = 1) {
  function parseSize(raw: string): number | null {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : clamp(parsed, min, max);
  }

  const [gridSize, setGridSizeRaw] = useLocalStorage<number>(storageKey, defaultValue, parseSize, String);

  const setGridSize = useCallback((size: number) => {
    setGridSizeRaw(clamp(size, min, max));
  }, [setGridSizeRaw, min, max]);

  return { gridSize, setGridSize, min, max, step } as const;
}
