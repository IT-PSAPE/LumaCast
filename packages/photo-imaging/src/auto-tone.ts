import sharp from "sharp";
import type { Recipe } from "@lumacast/photo-model";
import { isRawFile } from "@lumacast/photo-model";
import type { Renderer } from "./render.js";

/**
 * Auto Light.
 *
 * Inspired by darktable's exposure percentiles and RawTherapee's clipping
 * policy, but fitted to our developed 8-bit renderer rather than borrowing
 * sensor-domain calculations. Gamma, clamping and cropping sit between the
 * slider and the histogram. Auto here is a two-stage guardrail search:
 *
 *  1. derive a *desired* percentile profile that leaves any plausibly exposed
 *     frame exactly where the photographer put it, and moves only a frame that
 *     shows underexposure across the whole image;
 *  2. refine with a bounded, cached coarse-to-fine search over the real
 *     renderer, where a candidate is rejected outright if it hard-clips any
 *     channel beyond a small quantisation budget.
 *
 * The histogram is evidence, not judgement: it cannot see subject, intent, or
 * noise, so nothing here invents a look. Every accepted value is a value the
 * renderer actually produced.
 */

const lightKeys = [
  "exposure",
  "brightness",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
] as const;
type LightKey = (typeof lightKeys)[number];

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Per-key search bounds. Conservative: developed 8-bit data has no headroom. */
const bounds: Record<LightKey, { min: number; max: number }> = {
  exposure: { min: -1.5, max: 1.5 },
  brightness: { min: -15, max: 15 },
  contrast: { min: -20, max: 20 },
  highlights: { min: -35, max: 20 },
  shadows: { min: -25, max: 35 },
  whites: { min: -20, max: 20 },
  blacks: { min: -20, max: 20 },
};

/**
 * Safe EV bound. A RAW *file extension* does not grant extra developed 8-bit
 * headroom: by the time Auto measures, the render is the same 8-bit sRGB
 * buffer, so RAW and raster share one bound. The file type is only used to
 * decide how loudly to warn about noise on a large shadow lift.
 */
const MAX_EXPOSURE = bounds.exposure.max;

/** Coarse step for each coordinate, then a second pass at a third of it. */
const coarseSteps: Record<Exclude<LightKey, "exposure">, number> = {
  brightness: 6,
  contrast: 8,
  highlights: 16,
  shadows: 16,
  whites: 10,
  blacks: 10,
};

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
    /** Pixels whose *every* channel sits at byte 255, i.e. neutral white. */
    fullyClippedHighlights?: number;
    /**
     * Clipped pixels whose channels are strongly separated. A saturated red
     * blob clips its red channel without being an overexposed subject, so Auto
     * must not read it as underexposure evidence or try to "recover" it.
     */
    saturatedHighlights?: number;
  };
  color: { meanRGB: number[]; meanSaturation: number };
  space: string;
};

/**
 * Statistics come only from fully opaque pixels. A soft matte leaves a fringe of
 * partially transparent pixels whose colour is a blend of the subject and
 * whatever was behind it; including them biases both percentiles and the clip
 * tails. For a fully opaque photo this is identical to the renderer's own
 * histogram, so displayed percentages agree.
 */
export async function analyzePhoto(
  render: Renderer,
  file: string,
  recipe: Recipe,
): Promise<PhotoAnalysis> {
  const bytes = await render(file, recipe, {
    preview: true,
    maxDimension: 256,
    format: "png",
  });
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bins = new Float64Array(256),
    sums = [0, 0, 0],
    channels = [0, 1, 2].map(() => ({ shadows: 0, highlights: 0 }));
  let pixels = 0,
    shadows = 0,
    highlights = 0,
    saturatedHighlights = 0,
    fullyClippedHighlights = 0,
    saturation = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) continue;
    pixels++;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    bins[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
    // Clipping matches the renderer's histogram definition exactly: a channel
    // counts as clipped at byte 0 / byte 255, not in a fuzzy near-black band.
    if (min === 0) shadows++;
    if (max === 255) {
      highlights++;
      if (max && (max - min) / max > 0.3) saturatedHighlights++;
    }
    if (min === 255) fullyClippedHighlights++;
    saturation += max ? (max - min) / max : 0;
    for (let c = 0; c < 3; c++) {
      sums[c] += data[i + c] / 255;
      if (data[i + c] === 0) channels[c].shadows++;
      if (data[i + c] === 255) channels[c].highlights++;
    }
  }
  const q = (fraction: number) => {
    if (!pixels) return 0;
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += bins[i];
      if (sum >= fraction * pixels) return i / 255;
    }
    return 1;
  };
  const divisor = pixels || 1;
  return {
    width: info.width,
    height: info.height,
    pixels,
    percentiles: {
      p01: q(0.01),
      p05: q(0.05),
      p10: q(0.1),
      p50: q(0.5),
      p90: q(0.9),
      p95: q(0.95),
      p99: q(0.99),
    },
    clipping: {
      shadows: shadows / divisor,
      highlights: highlights / divisor,
      channels: channels.map((c) => ({
        shadows: c.shadows / divisor,
        highlights: c.highlights / divisor,
      })),
      fullyClippedHighlights: fullyClippedHighlights / divisor,
      saturatedHighlights: saturatedHighlights / divisor,
    },
    color: {
      meanRGB: sums.map((s) => s / divisor),
      meanSaturation: saturation / divisor,
    },
    space:
      "Developed 8-bit sRGB of the current crop, normalized 0-1, 256px sample, " +
      "fully opaque pixels only. Clipping is byte 0/255 in this buffer, not sensor RAW clipping.",
  };
}

type Percentiles = PhotoAnalysis["percentiles"];

/**
 * Underexposure read. A frame is only read as underexposed when the midtones
 * are genuinely low *and* the upper body never approaches white, i.e. the
 * whole image is dark rather than a dark scene with bright content in it.
 * A bright histogram is ambiguous (high-key subject, or an over-bright
 * capture) and is left to a human, not forced in either direction.
 */
const DARK_MIDTONE = 0.28;
const DARK_UPPER_BODY = 0.68;

/** Caps for the one policy that moves anything: a gentle whole-image lift. */
const MAX_MIDTONE_LIFT = 0.12;
const MAX_UPPER_BODY_LIFT = 0.14;
const MAX_SHADOW_LIFT = 0.025;
const MAX_WHITE_LIFT = 0.08;

/**
 * Desired percentile profile. Measured values are the baseline everywhere: no
 * target median, no forced range, no black point, and no downward pull on the
 * white end. The only non-measured values are a single capped lift applied
 * when the whole frame reads dark, and even then the shadow end is only moved
 * slightly so deep shadow is not crushed up to a floor.
 */
function desiredPercentiles(
  p: Percentiles,
  options: { clipLimited: boolean },
): Percentiles {
  const underexposed = p.p50 < DARK_MIDTONE && p.p95 < DARK_UPPER_BODY;
  if (!underexposed || options.clipLimited) return p;
  return {
    p01: p.p01,
    p05: p.p05,
    p10: p.p10 + MAX_SHADOW_LIFT,
    p50: p.p50 + MAX_MIDTONE_LIFT,
    p90: p.p90 + MAX_UPPER_BODY_LIFT,
    p95: p.p95 + MAX_UPPER_BODY_LIFT,
    p99: Math.min(1, p.p99 + MAX_WHITE_LIFT),
  };
}

/** True when a channel already carries a meaningful clipped tail. */
function clipLimited(a: PhotoAnalysis) {
  return (
    a.clipping.channels.some((c) => c.highlights > 0.01 || c.shadows > 0.01) ||
    (a.clipping.saturatedHighlights ?? 0) > 0.01
  );
}

function degenerate(a: PhotoAnalysis) {
  return a.pixels === 0 || a.percentiles.p95 - a.percentiles.p05 < 0.025;
}

const RENDER_BUDGET = 60;

export async function suggestAutoTone(
  render: Renderer,
  file: string,
  recipe: Recipe,
  reference?: { file: string; recipe: Recipe },
) {
  // Auto is defined as a full replacement of the Light group. It always reasons
  // about a neutral Light baseline so a stale curve cannot bias the search, and
  // so non-Light settings (colour, detail, lens, crop) are carried through
  // untouched.
  const base = { ...recipe };
  for (const key of lightKeys) base[key] = 0;

  const warnings: string[] = [];
  const replaced = lightKeys.filter((k) => recipe[k] !== 0);

  // Per-invocation render cache, keyed on the *whole* recipe: a crop, colour,
  // or lens change re-renders, so a same-file reference with different non-Light
  // settings never reads another recipe's statistics. Bounded by the budget,
  // never persisted.
  const cache = new Map<string, Promise<PhotoAnalysis>>();
  let budget = RENDER_BUDGET;
  let skippedForBudget = false;
  const recipeKey = (r: Recipe) =>
    JSON.stringify(
      Object.entries(r).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  const measuredAt = (f: string, r: Recipe) => {
    const key = `${f}\n${recipeKey(r)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    if (budget <= 0) {
      // Cached analyses stay usable at the budget; only new work is dropped.
      skippedForBudget = true;
      return null;
    }
    budget--;
    const pending = analyzePhoto(render, f, r);
    cache.set(key, pending);
    return pending;
  };

  const measured = (await measuredAt(file, base))!;
  const before = replaced.length
    ? ((await measuredAt(file, recipe)) ?? measured)
    : measured;
  const method = reference
    ? "Tone fit to the reference's measured histogram, with renderer-verified candidates"
    : "Histogram-guided tone fit with renderer-verified candidates";

  // A bail changes nothing, so it must not claim the Light group was replaced.
  const bail = (message: string) => ({
    patch: {} as Partial<Recipe>,
    before,
    after: before,
    warnings: [...warnings, message],
    method,
  });

  // Degenerate input preserves *all* edits: an empty patch leaves the recipe
  // exactly as the user had it, Light group included.
  if (degenerate(measured)) {
    if (measured.pixels === 0)
      return bail(
        "No fully opaque pixels to measure (transparent image or soft matte). Existing edits were preserved.",
      );
    return bail(
      "Too little tonal information for reliable Auto. Existing edits were preserved.",
    );
  }

  let targetP: Percentiles | null = null;
  if (reference) {
    const target = await measuredAt(reference.file, reference.recipe);
    if (!target)
      return bail(
        "The render budget was reached before the reference could be measured. Existing edits were preserved.",
      );
    if (degenerate(target))
      return bail(
        "Reference has too little tonal information. Existing edits were preserved.",
      );
    // The reference contributes its own measured tone, not a default band. p99
    // stays measured so fitting never greys out whites to chase a target; the
    // hard clip gate below still protects the actual clipped pixels.
    targetP = target.percentiles;
  }

  const p = measured.percentiles;
  const desired = targetP
    ? {
        ...p,
        p10: targetP.p10,
        p50: targetP.p50,
        p90: targetP.p90,
        p95: targetP.p95,
      }
    : desiredPercentiles(p, { clipLimited: clipLimited(measured) });

  // ---- honest, evidence-based warnings -------------------------------------
  if ((measured.clipping.saturatedHighlights ?? 0) > 0.01)
    warnings.push(
      "Clipped pixels are largely saturated colour, not lost highlight detail. Colour clipping is not treated as underexposure and cannot be undone by tone.",
    );
  else if (measured.clipping.highlights > 0.005)
    warnings.push(
      "Some developed channels are already clipped. Tone adjustment cannot reconstruct lost RAW or JPEG detail.",
    );
  if ((measured.clipping.fullyClippedHighlights ?? 0) > 0.001)
    warnings.push(
      "Some pixels are fully clipped neutral white. Auto preserves them; it does not turn them grey to fake detail.",
    );
  if (p.p99 >= 0.98)
    warnings.push(
      "The white end is already at the top of the range. Auto will not pull it down to manufacture gray detail.",
    );
  if (!reference && p.p50 > 0.7)
    warnings.push(
      "A bright histogram is ambiguous: a high-key subject and an over-bright capture look the same here. Auto will not darken it automatically; review it with vision.",
    );
  else if (!reference && p.p50 < DARK_MIDTONE)
    warnings.push(
      "The frame reads as possibly low-key. A histogram cannot tell subject brightness or intent; check it before accepting Auto.",
    );
  warnings.push(
    "Auto reads only the histogram: it cannot infer subject, intent, or ISO noise. Review the result.",
  );
  if (reference)
    warnings.push(
      "Reference fitting matches tone only. Review subject, color balance, and crop individually.",
    );
  if (replaced.length)
    warnings.push(
      `Auto replaces the existing Light settings (${replaced.join(", ")}) from a neutral baseline. Other settings are kept.`,
    );

  // ---- scoring and the hard clip gate ---------------------------------------
  // The gate is a measured hard-clip budget per channel, not a penalty: a
  // candidate that pushes any channel's new-shadow or new-highlight fraction
  // past the baseline plus the budget is rejected outright, whatever its tonal
  // gain. The budget only has to absorb byte quantisation and the sample size.
  const clipBudget = Math.max(0.002, 1 / Math.max(1, measured.pixels));
  const clipsTooHard = (a: PhotoAnalysis) =>
    // Lowering fully blown white to grey is not highlight reconstruction.
    (a.clipping.fullyClippedHighlights ?? 0) <
      (measured.clipping.fullyClippedHighlights ?? 0) - clipBudget ||
    a.clipping.channels.some(
      (c, i) =>
        c.highlights > measured.clipping.channels[i].highlights + clipBudget ||
        c.shadows > measured.clipping.channels[i].shadows + clipBudget,
    );

  const score = (a: PhotoAnalysis, r: Recipe) => {
    const q = a.percentiles;
    const tonal =
      3 * (q.p50 - desired.p50) ** 2 +
      (q.p10 - desired.p10) ** 2 +
      (q.p90 - desired.p90) ** 2 +
      1.5 * (q.p95 - desired.p95) ** 2 +
      // The white end is a preservation term: tiny weight, upward only.
      0.15 * (q.p99 - desired.p99) ** 2;
    // Regularisation, so the search only moves when the histogram says so.
    const restraint =
      0.0006 *
      ((r.exposure / MAX_EXPOSURE) ** 2 +
        (r.brightness / bounds.brightness.max) ** 2 +
        (r.contrast / bounds.contrast.max) ** 2 +
        (r.highlights / bounds.highlights.max) ** 2 +
        (r.shadows / bounds.shadows.max) ** 2 +
        (r.whites / bounds.whites.max) ** 2 +
        (r.blacks / bounds.blacks.max) ** 2);
    return tonal + restraint;
  };

  let best: Recipe = { ...base },
    after = measured,
    bestScore = score(measured, base);
  const result = () => ({
    // A neutral winner still clears previous Light edits. An empty patch is
    // correct only when the caller already has that neutral Light baseline.
    patch: (replaced.length || lightKeys.some((k) => best[k] !== 0)
      ? Object.fromEntries(lightKeys.map((k) => [k, best[k]]))
      : {}) as Partial<Recipe>,
    before,
    after,
    warnings,
    method,
  });
  // No target movement means no search is necessary. This avoids dozens of
  // preview renders for already-plausible profiles and exact reference fits.
  if (
    Object.keys(p).every(
      (key) =>
        p[key as keyof Percentiles] === desired[key as keyof Percentiles],
    )
  )
    return result();
  const consider = async (candidate: Recipe) => {
    const clamped = { ...candidate };
    for (const key of lightKeys)
      clamped[key] = clamp(clamped[key], bounds[key].min, bounds[key].max);
    if (lightKeys.every((k) => clamped[k] === best[k])) return;
    const analysis = await measuredAt(file, clamped);
    if (!analysis) return;
    if (clipsTooHard(analysis)) return;
    const value = score(analysis, clamped);
    if (value < bestScore - 1e-6) {
      best = clamped;
      after = analysis;
      bestScore = value;
    }
  };

  // Exposure seeding is only a *starting bracket* for the search, not a
  // solution: per-channel gamma and the other Light controls sit between the
  // slider and the histogram, so the closed form is inexact. Every value that
  // survives was produced and measured by the real renderer.
  const seed = clamp(
    Math.log2(
      Math.max(0.001, Math.pow(desired.p50, 2.2)) /
        Math.max(0.001, Math.pow(p.p50, 2.2)),
    ),
    -MAX_EXPOSURE,
    MAX_EXPOSURE,
  );
  for (const exposure of [0, seed, seed - 0.3, seed + 0.3, seed * 0.5].map(
    (e) => Math.round(clamp(e, -MAX_EXPOSURE, MAX_EXPOSURE) * 20) / 20,
  ))
    await consider({ ...base, exposure });

  // Bounded coarse-to-fine coordinate descent. Two passes, the second at a
  // third of the step, each coordinate evaluated from a snapshot of the
  // incumbent so a coordinate cannot chase its own tail.
  for (const pass of [1, 3] as const) {
    for (const key of Object.keys(
      coarseSteps,
    ) as (keyof typeof coarseSteps)[]) {
      const step = Math.max(1, Math.round(coarseSteps[key] / pass));
      const snapshot = { ...best };
      await consider({ ...snapshot, [key]: snapshot[key] - step });
      await consider({ ...snapshot, [key]: snapshot[key] + step });
    }
  }

  // Final exposure refinement around the incumbent, including dropping back to
  // zero so a lift found earlier can be released.
  const refined = { ...best };
  for (const exposure of [refined.exposure + 0.1, refined.exposure - 0.1, 0]) {
    const rounded =
      Math.round(clamp(exposure, -MAX_EXPOSURE, MAX_EXPOSURE) * 20) / 20;
    if (rounded === refined.exposure) continue;
    await consider({ ...refined, exposure: rounded });
  }

  if (skippedForBudget)
    warnings.push(
      "The render budget was reached, so Auto explored fewer candidates than usual.",
    );

  if (best.shadows > 20)
    warnings.push(
      `Auto lifted shadows by ${best.shadows}${isRawFile(file) ? " on a RAW file" : ""}; on developed 8-bit data this can amplify noise.`,
    );
  if (best.exposure < -0.15)
    warnings.push(
      "Auto reduced exposure as part of the tone fit. Check subject brightness visually; a histogram cannot establish the intended exposure.",
    );

  return result();
}
