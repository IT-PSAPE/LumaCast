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

export const LYRIC_LAYOUT_CONFIG_LIMITS = {
  boxWidth: { min: 100, max: 1920 },
  boxHeight: { min: 50, max: 1080 },
  fontSize: { min: 8, max: 400 },
  lineHeight: { min: 0.5, max: 3 },
  segmentsPerSlide: { min: 1, max: 12 },
} as const;

const STORAGE_KEY = 'lumacast.lyric-layout-config';

function clampToLimits(value: unknown, limits: { min: number; max: number }, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, parsed));
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function sanitizeLyricLayoutConfig(value: unknown): LyricLayoutConfig {
  const source = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    boxWidth: clampToLimits(source.boxWidth, LYRIC_LAYOUT_CONFIG_LIMITS.boxWidth, DEFAULT_LYRIC_LAYOUT_CONFIG.boxWidth),
    boxHeight: clampToLimits(source.boxHeight, LYRIC_LAYOUT_CONFIG_LIMITS.boxHeight, DEFAULT_LYRIC_LAYOUT_CONFIG.boxHeight),
    fontFamily: nonEmptyString(source.fontFamily, DEFAULT_LYRIC_LAYOUT_CONFIG.fontFamily),
    fontWeight: nonEmptyString(source.fontWeight, DEFAULT_LYRIC_LAYOUT_CONFIG.fontWeight),
    fontSize: clampToLimits(source.fontSize, LYRIC_LAYOUT_CONFIG_LIMITS.fontSize, DEFAULT_LYRIC_LAYOUT_CONFIG.fontSize),
    lineHeight: clampToLimits(source.lineHeight, LYRIC_LAYOUT_CONFIG_LIMITS.lineHeight, DEFAULT_LYRIC_LAYOUT_CONFIG.lineHeight),
    segmentsPerSlide: clampToLimits(
      Math.round(clampToLimits(source.segmentsPerSlide, { min: -Infinity, max: Infinity }, DEFAULT_LYRIC_LAYOUT_CONFIG.segmentsPerSlide)),
      LYRIC_LAYOUT_CONFIG_LIMITS.segmentsPerSlide,
      DEFAULT_LYRIC_LAYOUT_CONFIG.segmentsPerSlide,
    ),
  };
}

export function clampLyricLayoutConfig(config: LyricLayoutConfig): LyricLayoutConfig {
  return sanitizeLyricLayoutConfig(config);
}

export async function loadMeasureFont(config: LyricLayoutConfig): Promise<void> {
  if (typeof document === 'undefined') return;
  try {
    const fonts = (document as Document & { fonts?: { load: (font: string) => Promise<unknown> } }).fonts;
    if (!fonts) return;
    await fonts.load(`${config.fontWeight} ${config.fontSize}px "${config.fontFamily}"`);
  } catch {
    // best-effort: measurement proceeds with whatever face is available
  }
}

function readStoredConfig(): LyricLayoutConfig {
  if (typeof window === 'undefined') return DEFAULT_LYRIC_LAYOUT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LYRIC_LAYOUT_CONFIG;
    return sanitizeLyricLayoutConfig(JSON.parse(raw));
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
