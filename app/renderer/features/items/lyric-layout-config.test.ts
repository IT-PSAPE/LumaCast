import { describe, expect, it } from 'vitest';
import {
  clampLyricLayoutConfig,
  sanitizeLyricLayoutConfig,
  DEFAULT_LYRIC_LAYOUT_CONFIG,
} from './lyric-layout-config';

describe('sanitizeLyricLayoutConfig', () => {
  it('falls back to defaults for non-object input', () => {
    expect(sanitizeLyricLayoutConfig(null)).toEqual(DEFAULT_LYRIC_LAYOUT_CONFIG);
    expect(sanitizeLyricLayoutConfig(undefined)).toEqual(DEFAULT_LYRIC_LAYOUT_CONFIG);
    expect(sanitizeLyricLayoutConfig(42)).toEqual(DEFAULT_LYRIC_LAYOUT_CONFIG);
  });

  it('clamps out-of-range numbers per field', () => {
    const sanitized = sanitizeLyricLayoutConfig({
      boxWidth: 5,
      boxHeight: 9999,
      fontSize: -3,
      lineHeight: 42,
      segmentsPerSlide: 0,
    });
    expect(sanitized.boxWidth).toBe(100);
    expect(sanitized.boxHeight).toBe(1080);
    expect(sanitized.fontSize).toBe(8);
    expect(sanitized.lineHeight).toBe(3);
    expect(sanitized.segmentsPerSlide).toBe(1);
  });

  it('clamps above the ranges too', () => {
    const sanitized = sanitizeLyricLayoutConfig({
      boxWidth: 9999,
      boxHeight: 5000,
      fontSize: 100000,
      lineHeight: 10,
      segmentsPerSlide: 99,
    });
    expect(sanitized.boxWidth).toBe(1920);
    expect(sanitized.boxHeight).toBe(1080);
    expect(sanitized.fontSize).toBe(400);
    expect(sanitized.lineHeight).toBe(3);
    expect(sanitized.segmentsPerSlide).toBe(12);
  });

  it('rounds segmentsPerSlide to an integer within range', () => {
    expect(sanitizeLyricLayoutConfig({ segmentsPerSlide: 2.6 }).segmentsPerSlide).toBe(3);
    expect(sanitizeLyricLayoutConfig({ segmentsPerSlide: 0.4 }).segmentsPerSlide).toBe(1);
    expect(sanitizeLyricLayoutConfig({ segmentsPerSlide: 11.6 }).segmentsPerSlide).toBe(12);
  });

  it('falls back per field for non-finite numbers and empty strings', () => {
    const sanitized = sanitizeLyricLayoutConfig({
      boxWidth: 'not-a-number',
      fontFamily: '',
      fontWeight: null,
      fontSize: Number.NaN,
      lineHeight: Number.POSITIVE_INFINITY,
      segmentsPerSlide: 'nope',
    });
    expect(sanitized.boxWidth).toBe(DEFAULT_LYRIC_LAYOUT_CONFIG.boxWidth);
    expect(sanitized.fontFamily).toBe(DEFAULT_LYRIC_LAYOUT_CONFIG.fontFamily);
    expect(sanitized.fontWeight).toBe(DEFAULT_LYRIC_LAYOUT_CONFIG.fontWeight);
    expect(sanitized.fontSize).toBe(DEFAULT_LYRIC_LAYOUT_CONFIG.fontSize);
    expect(sanitized.lineHeight).toBe(DEFAULT_LYRIC_LAYOUT_CONFIG.lineHeight);
    expect(sanitized.segmentsPerSlide).toBe(DEFAULT_LYRIC_LAYOUT_CONFIG.segmentsPerSlide);
  });

  it('keeps valid values untouched', () => {
    const config = {
      boxWidth: 1200,
      boxHeight: 300,
      fontFamily: 'Helvetica',
      fontWeight: '300',
      fontSize: 64,
      lineHeight: 1.4,
      segmentsPerSlide: 4,
    };
    expect(sanitizeLyricLayoutConfig(config)).toEqual(config);
  });
});

describe('clampLyricLayoutConfig', () => {
  it('clamps dialog drafts on save', () => {
    const clamped = clampLyricLayoutConfig({
      ...DEFAULT_LYRIC_LAYOUT_CONFIG,
      boxWidth: 0,
      boxHeight: -50,
      fontSize: 9999,
      lineHeight: -1,
      segmentsPerSlide: 2.5,
    });
    expect(clamped).toEqual({
      ...DEFAULT_LYRIC_LAYOUT_CONFIG,
      boxWidth: 100,
      boxHeight: 50,
      fontSize: 400,
      lineHeight: 0.5,
      segmentsPerSlide: 3,
    });
  });
});
