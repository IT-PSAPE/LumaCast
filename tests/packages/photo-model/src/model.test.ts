// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  adjustmentControls,
  cropSchema,
  imageExtensions,
  importFormats,
  isRawFile,
  lensProfileSchema,
  neutralRecipe,
  patchSchema,
  rawExtensions,
  recipeSchema,
} from '@lumacast/photo-model';

describe('photo-model public entry point', () => {
  it('exports every adjustment control referenced by the recipe schema', () => {
    const controlKeys = adjustmentControls.map(([key]) => key);
    const recipeKeys = Object.keys(recipeSchema.shape);
    for (const key of controlKeys) {
      expect(recipeKeys).toContain(key);
    }
  });

  it('describes each adjustment control with a label, range, and step', () => {
    for (const [key, label, min, max, step, group] of adjustmentControls) {
      expect(key).toMatch(/^[a-zA-Z]+$/);
      expect(label.length).toBeGreaterThan(0);
      expect(min).toBeLessThanOrEqual(0);
      expect(max).toBeGreaterThan(0);
      expect(step).toBeGreaterThan(0);
      expect(group.length).toBeGreaterThan(0);
    }
  });

  it('classifies raw and rendered formats consistently', () => {
    expect(imageExtensions).toContain('jpeg');
    expect(importFormats).toContain('tiff');
    for (const extension of rawExtensions) {
      expect(imageExtensions).toContain(extension);
      expect(importFormats).toContain(extension);
    }
  });

  it('detects raw files by extension, case-insensitively', () => {
    expect(isRawFile('frame.CR3')).toBe(true);
    expect(isRawFile('/photos/a/b/shot.arw')).toBe(true);
    expect(isRawFile('notes.txt')).toBe(false);
    expect(isRawFile('noextension')).toBe(false);
  });
});

describe('recipe schemas', () => {
  it('produces a neutral recipe from an empty object', () => {
    const recipe = neutralRecipe();
    expect(recipe.exposure).toBe(0);
    expect(recipe.rotation).toBe(0);
    expect(recipe.lensProfile).toBeNull();
    expect(recipe.crop).toBeNull();
  });

  it('rejects unknown recipe fields', () => {
    expect(() => recipeSchema.parse({ ...neutralRecipe(), nope: 1 })).toThrow();
  });

  it('clamps nothing silently: out-of-range values fail', () => {
    expect(() => recipeSchema.parse({ ...neutralRecipe(), exposure: 9 })).toThrow();
    expect(() => recipeSchema.parse({ ...neutralRecipe(), rotation: 4 })).toThrow();
    expect(() => recipeSchema.parse({ ...neutralRecipe(), sharpening: -1 })).toThrow();
  });

  it('accepts a sparse patch without materialising defaults', () => {
    const patch = patchSchema.parse({ exposure: 1.5 });
    expect(Object.keys(patch)).toEqual(['exposure']);
  });

  it('rejects unknown patch fields', () => {
    expect(() => patchSchema.parse({ nope: 1 })).toThrow();
  });
});

describe('crop schema', () => {
  it('accepts a crop that fits inside the image', () => {
    const crop = cropSchema.parse({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    expect(crop.width).toBeCloseTo(0.8);
  });

  it('rejects a crop that overflows the image', () => {
    expect(() => cropSchema.parse({ x: 0.4, y: 0, width: 0.8, height: 1 })).toThrow();
    expect(() => cropSchema.parse({ x: 0, y: 0.4, width: 1, height: 0.8 })).toThrow();
  });

  it('rejects zero-area and out-of-range crops', () => {
    expect(() => cropSchema.parse({ x: 0, y: 0, width: 0, height: 0.5 })).toThrow();
    expect(() => cropSchema.parse({ x: -0.1, y: 0, width: 0.5, height: 0.5 })).toThrow();
  });
});

describe('lens profile schema', () => {
  const profile = {
    id: 'nikon-z-85',
    name: 'NIKKOR Z 85mm f/1.2 S',
    source: 'Lensfun' as const,
    revision: '1',
    cameraCrop: 1.5,
    calibrationCrop: 1.5,
    aspect: 1.5,
    focal: 85,
    distortion: { model: 'ptlens' as const, terms: [0, 0, 0] as [number, number, number] },
    tca: { model: 'linear' as const, terms: [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number] },
    vignette: [1, 0, 0] as [number, number, number],
  };

  it('accepts a complete calibration snapshot', () => {
    expect(lensProfileSchema.parse(profile).focal).toBe(85);
  });

  it('requires the Lensfun source tag', () => {
    expect(() => lensProfileSchema.parse({ ...profile, source: 'other' })).toThrow();
  });

  it('rejects out-of-range calibration terms', () => {
    expect(() =>
      lensProfileSchema.parse({ ...profile, vignette: [1, 0, 40] }),
    ).toThrow();
  });

  it('accepts a profile with optional corrections omitted', () => {
    const parsed = lensProfileSchema.parse({ ...profile, distortion: null, tca: null, vignette: null });
    expect(parsed.distortion).toBeNull();
  });
});
