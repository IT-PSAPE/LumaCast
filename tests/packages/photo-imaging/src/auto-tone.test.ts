// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  analyzePhoto,
  suggestAutoTone,
} from "../../../../packages/photo-imaging/src/auto-tone";
import { renderImage } from "../../../../packages/photo-imaging/src/render";
import { neutralRecipe } from "../../../../packages/photo-model/src/model";

type Ramp = (t: number) => [number, number, number];

/**
 * Renders a synthetic scene through a luminance ramp. `t` runs 0..1 left to
 * right, so every fixture has real tonal structure to measure. Fixtures are
 * written as intent ("underexposed", "low-key with a bright subject") and
 * asserted against qualitative outcomes, never against exact slider values.
 */
async function writeRamp(
  dir: string,
  name: string,
  width: number,
  height: number,
  shade: Ramp,
  alpha?: (t: number, y: number) => number,
) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = shade((x + 0.5) / width);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = alpha ? alpha((x + 0.5) / width, y) : 255;
    }
  const file = path.join(dir, name + ".png");
  await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(file);
  return file;
}

const linearRamp =
  (lo: number, hi: number): Ramp =>
  (t) => {
    const v = Math.round((lo + (hi - lo) * t) * 255);
    return [v, v, v];
  };

describe("auto tone analysis", () => {
  it("reports clipping on the exact byte boundaries the renderer histogram uses", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-clip-"));
    try {
      // Half the rows sit at byte 1 (not clipped, no shadow tail) and half at
      // byte 0 (clipped). The analysis must agree with the renderer's
      // `value === 0` / `value === 255` definition, not a fuzzy near-black band.
      const file = await writeRamp(dir, "edges", 8, 4, (t) => {
        const v = t < 0.5 ? 1 : 0;
        return [v, v, v];
      });
      const a = await analyzePhoto(renderImage, file, neutralRecipe());
      expect(a.pixels).toBe(32);
      expect(a.clipping.shadows).toBeCloseTo(0.5, 5);
      expect(a.clipping.highlights).toBe(0);
      for (const c of a.clipping.channels) {
        expect(c.shadows).toBeCloseTo(0.5, 5);
        expect(c.highlights).toBe(0);
      }

      const white = await writeRamp(dir, "white", 8, 4, () => [255, 255, 255]);
      const b = await analyzePhoto(renderImage, white, neutralRecipe());
      expect(b.clipping.highlights).toBe(1);
      expect(b.clipping.shadows).toBe(0);
      expect(b.clipping.channels.every((c) => c.highlights === 1)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("separates saturated colour clipping from lost highlight detail", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-sat-"));
    try {
      // A ramp that tops out on fully saturated red: the red channel clips, but
      // the image is not underexposed and must not be diagnosed as such.
      const file = await writeRamp(dir, "saturated", 64, 32, (t) => [
        255,
        Math.round(10 + t * 60),
        Math.round(4 + t * 20),
      ]);
      const a = await analyzePhoto(renderImage, file, neutralRecipe());
      expect(a.clipping.channels[0].highlights).toBeGreaterThan(0.9);
      expect(a.clipping.channels[1].highlights).toBe(0);
      expect(a.color.meanSaturation).toBeGreaterThan(0.5);
      expect(a.clipping.saturatedHighlights).toBeGreaterThan(0.9);

      const s = await suggestAutoTone(renderImage, file, neutralRecipe());
      // Saturated colour is not underexposure, so Auto leaves it alone rather
      // than pushing it darker to "recover" the clipped red channel.
      expect(s.after.percentiles.p50).toBeGreaterThanOrEqual(
        s.before.percentiles.p50 - 0.02,
      );
      expect(Object.values(s.patch).every((v) => v === 0)).toBe(true);
      expect(s.before.percentiles).toEqual(s.after.percentiles);
      expect(s.warnings.join(" ")).toMatch(/colour|color/i);
      expect(s.method).not.toMatch(/intent/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores alpha-fringe pixels and refuses to edit without opaque samples", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-alpha-"));
    try {
      // Opaque interior, fully transparent border: the border must not
      // contaminate the measured percentiles.
      const opaque = await writeRamp(
        dir,
        "fringe",
        64,
        64,
        linearRamp(0.4, 0.6),
        (t, y) => (t > 0.1 && t < 0.9 && y > 10 && y < 50 ? 255 : 0),
      );
      const a = await analyzePhoto(renderImage, opaque, neutralRecipe());
      // Columns 6..57 and rows 11..49 are the only opaque samples; the
      // transparent border must not be counted or measured.
      expect(a.pixels).toBe(52 * 39);
      expect(a.percentiles.p50).toBeGreaterThan(0.4);
      expect(a.percentiles.p50).toBeLessThan(0.62);

      // A soft matte (partial alpha everywhere) is all fringe: no reliable
      // samples, so Auto must return an empty patch and keep every edit.
      const matted = await writeRamp(
        dir,
        "matted",
        32,
        32,
        linearRamp(0.2, 0.8),
        () => 8,
      );
      const m = await suggestAutoTone(renderImage, matted, {
        ...neutralRecipe(),
        exposure: 0.5,
        temperature: 80,
      });
      expect(m.patch).toEqual({});
      expect(m.before.pixels).toBe(0);
      expect(m.warnings.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("states the measurement space and the limit it actually has", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-space-"));
    try {
      const file = await writeRamp(dir, "space", 32, 32, linearRamp(0.2, 0.8));
      const a = await analyzePhoto(renderImage, file, neutralRecipe());
      // The description has to name what was measured: the developed 8-bit sRGB
      // buffer of the current crop, with clipping defined on byte 0/255 of that
      // buffer. That is the meaningful limit — anything the description implies
      // about the analysis is bounded by it.
      expect(a.space).toMatch(/8-?bit/i);
      expect(a.space).toMatch(/srgb/i);
      expect(a.space).toMatch(/crop/i);
      expect(a.space).toMatch(/byte 0\/255/);
      // And it must not quietly claim a scene-linear measurement.
      expect(a.space).not.toMatch(/scene-linear/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("auto tone suggestions", () => {
  it("brightens a genuinely underexposed frame instead of forcing a fixed median", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-dark-"));
    try {
      const file = await writeRamp(
        dir,
        "underexposed",
        128,
        64,
        linearRamp(0.05, 0.5),
      );
      const s = await suggestAutoTone(renderImage, file, neutralRecipe());
      expect(s.after.percentiles.p50).toBeGreaterThan(
        s.before.percentiles.p50 + 0.04,
      );
      expect(s.after.percentiles.p95).toBeGreaterThan(
        s.before.percentiles.p95 + 0.03,
      );
      expect(s.patch.exposure).toBeGreaterThan(0);
      // The lift is capped, not aimed at a target median.
      expect(s.after.percentiles.p50).toBeLessThan(0.6);
      // The hard clip gate: no channel gains clipping beyond the quantisation
      // budget, in exchange for nothing.
      s.after.clipping.channels.forEach((c, i) => {
        expect(c.highlights).toBeLessThanOrEqual(
          s.before.clipping.channels[i].highlights + 0.002,
        );
        expect(c.shadows).toBeLessThanOrEqual(
          s.before.clipping.channels[i].shadows + 0.002,
        );
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves a healthy mid-key image alone", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-ok-"));
    try {
      const file = await writeRamp(
        dir,
        "healthy",
        128,
        64,
        linearRamp(0.2, 0.82),
      );
      const s = await suggestAutoTone(renderImage, file, neutralRecipe());
      expect(
        Math.abs(s.after.percentiles.p50 - s.before.percentiles.p50),
      ).toBeLessThan(0.03);
      expect(
        Math.abs(s.after.percentiles.p95 - s.before.percentiles.p95),
      ).toBeLessThan(0.05);
      expect(Math.abs(s.patch.exposure ?? 0)).toBeLessThan(0.2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clears prior Light edits when the neutral profile wins without searching", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-neutral-"));
    try {
      const file = await writeRamp(
        dir,
        "healthy",
        128,
        64,
        linearRamp(0.2, 0.82),
      );
      const original = { ...neutralRecipe(), exposure: -0.6, highlights: 12 };
      let renders = 0;
      const counted: typeof renderImage = async (f, recipe, options) => {
        renders++;
        return renderImage(f, recipe, options);
      };
      const s = await suggestAutoTone(counted, file, original);
      expect(renders).toBe(2); // Neutral baseline and caller's current rendering.
      expect(s.patch).toEqual({
        exposure: 0,
        brightness: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
      });
      expect(s.before.percentiles).not.toEqual(s.after.percentiles);
      const applied = await analyzePhoto(renderImage, file, {
        ...original,
        ...s.patch,
      });
      expect(applied.percentiles).toEqual(s.after.percentiles);
      expect(s.warnings.join(" ")).toMatch(/replaces/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("only measures once when a neutral profile already meets the default target", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-noop-"));
    try {
      const file = await writeRamp(
        dir,
        "healthy",
        128,
        64,
        linearRamp(0.2, 0.82),
      );
      let renders = 0;
      const counted: typeof renderImage = async (f, recipe, options) => {
        renders++;
        return renderImage(f, recipe, options);
      };
      const s = await suggestAutoTone(counted, file, neutralRecipe());
      expect(renders).toBe(1);
      expect(s.patch).toEqual({});
      expect(s.before).toEqual(s.after);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves a low-key scene that already has a bright subject", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-lowkey-"));
    try {
      // Most of the frame is deep shadow, but the right third is a lit subject.
      // The bright content is evidence of intent, not an underexposure bug.
      const file = await writeRamp(dir, "lowkey", 128, 64, (t) => {
        const v = t < 0.6 ? 0.06 + t * 0.12 : 0.6 + (t - 0.6) * 0.7;
        const b = Math.round(v * 255);
        return [b, b, b];
      });
      const before = await analyzePhoto(renderImage, file, neutralRecipe());
      expect(before.percentiles.p50).toBeLessThan(0.3);
      expect(before.percentiles.p99).toBeGreaterThan(0.85);

      const s = await suggestAutoTone(renderImage, file, neutralRecipe());
      // Dark midtones alone are not enough: the upper body already reaches
      // white, so this is a night scene, not an underexposed one.
      expect(s.after.percentiles.p95).toBeGreaterThanOrEqual(
        s.before.percentiles.p95 - 0.02,
      );
      expect(
        Math.abs(s.after.percentiles.p50 - s.before.percentiles.p50),
      ).toBeLessThan(0.05);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves high-key white surfaces rather than dragging them to mid grey", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-highkey-"));
    try {
      // A high-key frame whose top tenth is genuinely blown neutral white.
      const file = await writeRamp(dir, "highkey", 128, 64, (t) => {
        const b = Math.round(Math.min(1, 0.55 + t * 0.5) * 255);
        return [b, b, b];
      });
      expect(
        (await analyzePhoto(renderImage, file, neutralRecipe())).clipping
          .fullyClippedHighlights,
      ).toBeGreaterThan(0.05);
      const s = await suggestAutoTone(renderImage, file, neutralRecipe());
      expect(s.after.percentiles.p50).toBeGreaterThan(0.7);
      expect(
        Math.abs(s.after.percentiles.p50 - s.before.percentiles.p50),
      ).toBeLessThan(0.03);
      expect(s.after.clipping.highlights).toBeLessThanOrEqual(
        s.before.clipping.highlights + 0.002,
      );
      expect(s.after.clipping.fullyClippedHighlights).toBeGreaterThanOrEqual(
        (s.before.clipping.fullyClippedHighlights ?? 0) - 0.002,
      );
      expect(s.after.percentiles.p99).toBeGreaterThanOrEqual(
        s.before.percentiles.p99 - 0.05,
      );
      // A bright histogram is ambiguous, so it is referred for review rather
      // than forced in either direction.
      expect(s.warnings.join(" ")).toMatch(/ambiguous|review/i);
      expect(s.method).not.toMatch(/intent/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves a misty low-contrast frame instead of forcing a contrast lift", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-haze-"));
    try {
      const file = await writeRamp(
        dir,
        "hazy",
        128,
        64,
        linearRamp(0.42, 0.66),
      );
      const s = await suggestAutoTone(renderImage, file, neutralRecipe());
      // Mist is a plausible exposure, not an underexposure bug: Auto must not
      // lift the midtones or invent separation that the scene never had.
      expect(
        Math.abs(s.after.percentiles.p50 - s.before.percentiles.p50),
      ).toBeLessThan(0.03);
      expect(
        Math.abs(s.after.percentiles.p95 - s.before.percentiles.p95),
      ).toBeLessThan(0.05);
      expect(Math.abs(s.patch.contrast ?? 0)).toBeLessThanOrEqual(5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a flat frame flat instead of inventing separation", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-flat-"));
    try {
      const file = await writeRamp(dir, "flat", 64, 64, () => {
        const b = Math.round(0.3 * 255);
        return [b, b, b];
      });
      const s = await suggestAutoTone(renderImage, file, neutralRecipe());
      expect(s.patch).toEqual({});
      expect(s.warnings.join(" ")).toMatch(/tonal information/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("never turns fully clipped whites into grey to fake recovered detail", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "lumaflux-auto-clipwhite-"),
    );
    try {
      const file = await writeRamp(dir, "clipped", 128, 64, (t) => {
        const v = t < 0.75 ? 0.2 + t * 0.4 : 1;
        const b = Math.round(Math.min(1, v) * 255);
        return [b, b, b];
      });
      const before = await analyzePhoto(renderImage, file, neutralRecipe());
      expect(before.clipping.fullyClippedHighlights).toBeGreaterThan(0.2);
      const s = await suggestAutoTone(renderImage, file, neutralRecipe());
      // Clipped whites stay clipped: the hard clip gate rejects any candidate
      // that spends them, rather than trading a few pixels for a tonal gain.
      expect(s.after.percentiles.p99).toBe(1);
      expect(s.after.clipping.highlights).toBeLessThanOrEqual(
        before.clipping.highlights + 0.002,
      );
      s.after.clipping.channels.forEach((c, i) => {
        expect(c.highlights).toBeLessThanOrEqual(
          before.clipping.channels[i].highlights + 0.002,
        );
      });
      expect(s.after.clipping.fullyClippedHighlights).toBeGreaterThanOrEqual(
        (before.clipping.fullyClippedHighlights ?? 0) - 0.002,
      );
      expect(s.warnings.join(" ")).toMatch(/clipped/i);
      // It must not claim to have recovered anything.
      expect(s.warnings.join(" ")).not.toMatch(/recov/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replaces pre-existing Light settings, keeps other settings, and says so", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-replace-"));
    try {
      const file = await writeRamp(
        dir,
        "replace",
        128,
        64,
        linearRamp(0.05, 0.5),
      );
      const recipe = {
        ...neutralRecipe(),
        exposure: -1.5,
        contrast: 40,
        temperature: 70,
        tint: -80,
        saturation: 25,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        rotation: 1,
        lensVignette: 12,
        sharpening: 20,
      };
      const s = await suggestAutoTone(renderImage, file, recipe);
      expect(Object.keys(s.patch).sort()).toEqual([
        "blacks",
        "brightness",
        "contrast",
        "exposure",
        "highlights",
        "shadows",
        "whites",
      ]);
      // Auto starts from a neutral Light baseline, so a stale +40 contrast is
      // not carried forward.
      expect(s.patch.contrast).toBeLessThan(40);
      expect(s.warnings.join(" ")).toMatch(/replac/i);

      // The patch is a full Light replacement, so applying it to the recipe the
      // user handed in must reproduce the reported `after` exactly. `before`
      // must also be the measurement of *that* recipe, crop and colour
      // included, not of a differently-keyed one.
      const applied = { ...recipe, ...s.patch } as typeof recipe;
      const appliedAnalysis = await analyzePhoto(renderImage, file, applied);
      expect(appliedAnalysis.percentiles).toEqual(s.after.percentiles);
      expect(appliedAnalysis.clipping.channels).toEqual(
        s.after.clipping.channels,
      );
      expect(
        (await analyzePhoto(renderImage, file, recipe)).percentiles,
      ).toEqual(s.before.percentiles);
      // Non-Light settings survive the patch.
      expect(applied.temperature).toBe(70);
      expect(applied.tint).toBe(-80);
      expect(applied.saturation).toBe(25);
      expect(applied.crop).toEqual(recipe.crop);
      expect(applied.rotation).toBe(1);
      expect(applied.sharpening).toBe(20);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("measures the same file under different non-Light settings separately", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-cache-"));
    try {
      // A left-to-right ramp: a crop changes which part of it is measured, so
      // a cache keyed only on the Light keys would reuse the wrong statistics
      // for the same file.
      const file = await writeRamp(
        dir,
        "cache",
        128,
        64,
        linearRamp(0.05, 0.6),
      );
      // The right half of the ramp: a crop changes which part of the frame is
      // measured, so a cache keyed only on the Light keys would reuse another
      // recipe's statistics for the same file.
      const brightHalf = {
        ...neutralRecipe(),
        crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
      };
      const wide = {
        ...neutralRecipe(),
        crop: { x: 0, y: 0, width: 1, height: 1 },
      };
      const halfStats = await analyzePhoto(renderImage, file, brightHalf);
      const wideStats = await analyzePhoto(renderImage, file, wide);
      expect(halfStats.percentiles.p50).toBeGreaterThan(
        wideStats.percentiles.p50,
      );

      const a = await suggestAutoTone(renderImage, file, brightHalf);
      expect(a.before.percentiles).toEqual(halfStats.percentiles);

      // The same file used as a reference under two different non-Light
      // recipes must give two different fits: the bright half is a much lighter
      // target than the whole frame, and the fit follows it.
      const refHalf = await suggestAutoTone(renderImage, file, wide, {
        file,
        recipe: brightHalf,
      });
      const refWide = await suggestAutoTone(renderImage, file, wide, {
        file,
        recipe: wide,
      });
      expect(refWide.after.percentiles.p50).toBeCloseTo(
        wideStats.percentiles.p50,
        5,
      );
      expect(refHalf.after.percentiles.p50).toBeGreaterThan(
        refWide.after.percentiles.p50 + 0.05,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("touches nothing outside the Light group", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-scope-"));
    try {
      const file = await writeRamp(
        dir,
        "scope",
        128,
        64,
        linearRamp(0.05, 0.5),
      );
      const s = await suggestAutoTone(renderImage, file, neutralRecipe());
      for (const key of Object.keys(s.patch)) {
        expect([
          "exposure",
          "brightness",
          "contrast",
          "highlights",
          "shadows",
          "whites",
          "blacks",
        ]).toContain(key);
      }
      expect(s.patch).not.toHaveProperty("crop");
      expect(s.patch).not.toHaveProperty("rotation");
      expect(s.patch).not.toHaveProperty("lensProfile");
      expect(s.patch).not.toHaveProperty("temperature");
      expect(s.patch).not.toHaveProperty("sharpening");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fits a reference tone without copying its colour, detail, or crop", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-ref-"));
    try {
      const dark = await writeRamp(
        dir,
        "ref-dark",
        128,
        64,
        linearRamp(0.05, 0.5),
      );
      const bright = await writeRamp(
        dir,
        "ref-bright",
        128,
        64,
        linearRamp(0.3, 0.9),
      );
      const s = await suggestAutoTone(renderImage, dark, neutralRecipe(), {
        file: bright,
        recipe: { ...neutralRecipe(), contrast: 15, temperature: -60 },
      });
      const target = await analyzePhoto(renderImage, bright, neutralRecipe());
      expect(
        Math.abs(s.after.percentiles.p50 - target.percentiles.p50),
      ).toBeLessThan(
        Math.abs(s.before.percentiles.p50 - target.percentiles.p50),
      );
      expect("crop" in s.patch).toBe(false);
      expect("lensProfile" in s.patch).toBe(false);
      expect("temperature" in s.patch).toBe(false);
      expect("contrast" in s.patch).toBe(true);
      // The reference's contrast is a tone decision to be evaluated, not
      // copied verbatim.
      expect(s.patch.contrast).not.toBe(15);
      expect(s.warnings.join(" ")).toMatch(/reference/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not grey fully clipped whites to fit a darker reference", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "lumaflux-auto-ref-white-"),
    );
    try {
      const file = await writeRamp(dir, "clipped", 128, 64, (t) => {
        const value = t > 0.85 ? 255 : Math.round((0.3 + t * 0.5) * 255);
        return [value, value, value];
      });
      const target = await writeRamp(
        dir,
        "target",
        128,
        64,
        linearRamp(0.04, 0.3),
      );
      const s = await suggestAutoTone(renderImage, file, neutralRecipe(), {
        file: target,
        recipe: neutralRecipe(),
      });
      expect(s.after.clipping.fullyClippedHighlights).toBeGreaterThanOrEqual(
        (s.before.clipping.fullyClippedHighlights ?? 0) - 0.002,
      );
      expect(s.after.percentiles.p99).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves existing edits when the reference has no reliable tonal information", async () => {
    const dir = await mkdtemp(
      path.join(os.tmpdir(), "lumaflux-auto-ref-flat-"),
    );
    try {
      const file = await writeRamp(
        dir,
        "source",
        128,
        64,
        linearRamp(0.05, 0.5),
      );
      const flat = await writeRamp(dir, "reference", 64, 64, () => [
        180, 180, 180,
      ]);
      const original = { ...neutralRecipe(), exposure: 0.2, temperature: 20 };
      const s = await suggestAutoTone(renderImage, file, original, {
        file: flat,
        recipe: neutralRecipe(),
      });
      expect(s.patch).toEqual({});
      expect(s.after).toEqual(s.before);
      expect(s.warnings.join(" ")).toMatch(/reference.*tonal information/i);
      expect(s.warnings.join(" ")).not.toMatch(/replaces/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is deterministic: re-running Auto on its own result repeats the patch", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-repeat-"));
    try {
      const file = await writeRamp(
        dir,
        "repeat",
        128,
        64,
        linearRamp(0.05, 0.5),
      );
      const a = await suggestAutoTone(renderImage, file, neutralRecipe());
      expect(Object.keys(a.patch)).toHaveLength(7);
      const b = await suggestAutoTone(renderImage, file, {
        ...neutralRecipe(),
        ...a.patch,
      });
      expect(b.patch).toEqual(a.patch);
      expect(b.before.percentiles).toEqual(a.after.percentiles);
      // Applying the first result and asking again is a fixed point, so the
      // reported `after` is the render the user would actually get.
      expect(
        (
          await analyzePhoto(renderImage, file, {
            ...neutralRecipe(),
            ...b.patch,
          })
        ).percentiles,
      ).toEqual(b.after.percentiles);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("bounds its own render budget", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lumaflux-auto-budget-"));
    try {
      const file = await writeRamp(
        dir,
        "budget",
        128,
        64,
        linearRamp(0.05, 0.5),
      );
      const bright = await writeRamp(
        dir,
        "budget-ref",
        128,
        64,
        linearRamp(0.3, 0.9),
      );
      const counted = async () => {
        let renders = 0;
        const render = async (
          f: string,
          recipe: Parameters<typeof renderImage>[1],
          options?: Parameters<typeof renderImage>[2],
        ) => {
          renders++;
          return renderImage(f, recipe, options);
        };
        return { render, count: () => renders };
      };
      const plain = await counted();
      await suggestAutoTone(plain.render, file, neutralRecipe());
      expect(plain.count()).toBeLessThanOrEqual(60);

      const withRef = await counted();
      await suggestAutoTone(withRef.render, file, neutralRecipe(), {
        file: bright,
        recipe: neutralRecipe(),
      });
      expect(withRef.count()).toBeLessThanOrEqual(60);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
