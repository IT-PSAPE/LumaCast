import { useCallback, useEffect, useState } from 'react';

export type LyricLayoutConfig = {
  boxWidth: number;
  boxHeight: number;
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
  lineHeight: number;
  segmentsPerSlide: number;
};

export const DEFAULT_LYRIC_LAYOUT_CONFIG: LyricLayoutConfig = {
  boxWidth: 1767,
  boxHeight: 210,
  fontFamily: 'Arial',
  fontWeight: '700',
  fontSize: 81,
  lineHeight: 1.2,
  segmentsPerSlide: 1,
};

const STORAGE_KEY = 'lumacast.lyric-layout-config';

function readStoredConfig(): LyricLayoutConfig {
  if (typeof window === 'undefined') return DEFAULT_LYRIC_LAYOUT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LYRIC_LAYOUT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<LyricLayoutConfig>;
    return { ...DEFAULT_LYRIC_LAYOUT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_LYRIC_LAYOUT_CONFIG;
  }
}

export function useLyricLayoutConfig() {
  const [config, setConfig] = useState<LyricLayoutConfig>(() => readStoredConfig());

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setConfig(readStoredConfig());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateConfig = useCallback((next: LyricLayoutConfig) => {
    setConfig(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota / serialization errors
    }
  }, []);

  return { config, updateConfig };
}
