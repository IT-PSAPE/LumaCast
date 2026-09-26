// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { correctLens } from '../../../../packages/photo-imaging/src/lens';
import { denoise } from '../../../../packages/photo-imaging/src/denoise';
import {
  neutralRecipe,
  patchSchema,
  recipeSchema,
} from '../../../../packages/photo-model/src/model';

function fixture(w = 96, h = 64) {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = x * 2;
      data[i + 1] = y * 3;
      data[i + 2] = 90;
      data[i + 3] = 255;
    }
  return data;
}

describe('correction defaults', () => {
  it('legacy recipes and partial patches remain compatible with correction defaults', () => {
    const r = recipeSchema.parse({ exposure: 1 });
    expect(r.lensDistortion).toBe(0);
    expect(r.noiseLuminance).toBe(0);
    expect(r.noiseColor).toBe(0);
    expect(patchSchema.parse({ noiseColor: 50 })).toEqual({ noiseColor: 50 });
    expect(() => patchSchema.parse({ noiseColor: 101 })).toThrow();
    expect(() => patchSchema.parse({ lensDistortion: Infinity })).toThrow();
  });
});

describe('lens correction', () => {
  it('zero corrections are exact identity; lens warp is bounded and does not mutate input', () => {
    const input = fixture(),
      original = Buffer.from(input),
      r = neutralRecipe();
    expect(correctLens(input, 96, 64, r)).toEqual(input);
    expect(denoise(input, 96, 64, 0, 0)).toEqual(input);
    for (const lensDistortion of [-100, 100]) {
      const out = correctLens(input, 96, 64, {
        ...r,
        lensDistortion,
        lensRed: 100,
        lensBlue: -100,
      });
      expect(out).not.toEqual(input);
      for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255);
    }
    expect(input).toEqual(original);
  });

  it('corner illumination lifts edges while leaving the optical center unchanged', () => {
    const input = Buffer.alloc(65 * 65 * 4, 80);
    for (let i = 3; i < input.length; i += 4) input[i] = 255;
    const out = correctLens(input, 65, 65, {
      ...neutralRecipe(),
      lensVignette: 100,
    });
    expect(out[(32 * 65 + 32) * 4]).toBe(80);
    expect(out[0]).toBeGreaterThan(120);
  });

  it('chromatic alignment moves a color channel relative to green', () => {
    const w = 512,
      h = 64,
      input = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        input[i] = input[i + 1] = input[i + 2] = x < 400 ? 30 : 220;
        input[i + 3] = 255;
      }
    const out = correctLens(input, w, h, { ...neutralRecipe(), lensRed: -100 });
    const i = (32 * w + 400) * 4;
    expect(out[i]).toBeLessThan(out[i + 1]);
    expect(out[i + 1]).toBe(input[i + 1]);
  });
});

describe('denoise', () => {
  it('luminance denoising reduces noise while retaining a strong edge and alpha', () => {
    const w = 96,
      h = 64,
      input = Buffer.alloc(w * h * 4);
    let seed = 123;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        const value = (x < w / 2 ? 40 : 210) + (seed % 41) - 20;
        const i = (y * w + x) * 4;
        input[i] = input[i + 1] = input[i + 2] = value;
        input[i + 3] = 255;
      }
    const out = denoise(input, w, h, 100, 0);
    let before = 0,
      after = 0;
    for (let y = 4; y < h - 4; y++)
      for (let x = 4; x < 40; x++) {
        const i = (y * w + x) * 4;
        before += (input[i] - 40) ** 2;
        after += (out[i] - 40) ** 2;
      }
    expect(after < before * 0.6, `${after}/${before}`).toBe(true);
    expect(out[(32 * w + 48) * 4] - out[(32 * w + 47) * 4]).toBeGreaterThan(140);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(input[i]);
  });

  it('color denoising reduces chroma speckles without removing luminance structure', () => {
    const w = 64,
      h = 48,
      input = Buffer.alloc(w * h * 4);
    let seed = 8;
    for (let i = 0; i < input.length; i += 4) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const n = (seed % 41) - 20;
      input[i] = 128 + n;
      input[i + 1] = 128;
      input[i + 2] = 128 - n;
      input[i + 3] = 255;
    }
    const out = denoise(input, w, h, 0, 100);
    let before = 0,
      after = 0;
    for (let i = 0; i < input.length; i += 4) {
      before += (input[i] - input[i + 2]) ** 2;
      after += (out[i] - out[i + 2]) ** 2;
      const y = (b: Buffer) => 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
      expect(Math.abs(y(out) - y(input)) < 2).toBe(true);
    }
    expect(after < before * 0.6).toBe(true);
  });
});
