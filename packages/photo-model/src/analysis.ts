import type { Recipe } from './model.js';

/** Statistics of the developed, fully opaque pixels, independent of the renderer. */
export type PhotoAnalysis = {
  width: number;
  height: number;
  pixels: number;
  percentiles: {
    p01: number;
    p05: number;
    p10: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  clipping: {
    shadows: number;
    highlights: number;
    channels: { shadows: number; highlights: number }[];
    /** Pixels whose every channel sits at byte 255, i.e. neutral white. */
    fullyClippedHighlights?: number;
    /** Saturated colour clipping, distinguished from overexposed subject detail. */
    saturatedHighlights?: number;
  };
  color: { meanRGB: number[]; meanSaturation: number };
  space: string;
};

export type AutoToneSuggestion = {
  patch: Partial<Recipe>;
  before: PhotoAnalysis;
  after: PhotoAnalysis;
  warnings: string[];
  method: string;
};
