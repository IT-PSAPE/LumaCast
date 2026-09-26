import sharp from "sharp";
import type { Recipe } from "@lumacast/photo-model";
import { isRawFile } from "@lumacast/photo-model";
import type { Renderer } from "./render.js";
const lightKeys = [
  "exposure",
  "brightness",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
] as const;
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
const linear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
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
  };
  color: { meanRGB: number[]; meanSaturation: number };
  space: string;
};
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
    saturation = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    pixels++;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2],
      max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    bins[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++;
    if (min <= 1) shadows++;
    if (max >= 254) highlights++;
    saturation += max ? (max - min) / max : 0;
    for (let c = 0; c < 3; c++) {
      sums[c] += data[i + c] / 255;
      if (data[i + c] <= 1) channels[c].shadows++;
      if (data[i + c] >= 254) channels[c].highlights++;
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
    },
    color: {
      meanRGB: sums.map((s) => s / divisor),
      meanSaturation: saturation / divisor,
    },
    space:
      "Rendered sRGB; normalized 0–1; 256px sample. Clipping is not sensor RAW clipping.",
  };
}
export async function suggestAutoTone(
  render: Renderer,
  file: string,
  recipe: Recipe,
  reference?: { file: string; recipe: Recipe },
) {
  const base = { ...recipe };
  for (const key of lightKeys) base[key] = 0;
  const measured = await analyzePhoto(render, file, base);
  const before = lightKeys.some((k) => recipe[k] !== 0)
    ? await analyzePhoto(render, file, recipe)
    : measured;
  const warnings: string[] = [];
  const method = reference
    ? "Per-image rendered-reference tone fit"
    : "Conservative percentile tone fit";
  if (
    measured.pixels === 0 ||
    measured.percentiles.p95 - measured.percentiles.p05 < 0.025
  )
    return {
      patch: {} as Partial<Recipe>,
      before,
      after: before,
      warnings: [
        "Too little tonal information for reliable Auto. Existing edits were preserved.",
      ],
      method,
    };
  const target = reference
    ? await analyzePhoto(render, reference.file, reference.recipe)
    : null;
  if (
    target &&
    (!target.pixels || target.percentiles.p95 - target.percentiles.p05 < 0.025)
  )
    return {
      patch: {} as Partial<Recipe>,
      before,
      after: before,
      warnings: [
        "Reference has too little tonal information. Existing edits were preserved.",
      ],
      method,
    };
  const p = measured.percentiles;
  const desired = target?.percentiles ?? {
    ...p,
    p10: clamp(p.p10, 0.055, 0.22),
    p50: p.p50 + clamp(0.46 - p.p50, -0.12, 0.22),
    p90: clamp(p.p90, 0.68, 0.92),
    p99: clamp(p.p99, 0.8, 0.98),
  };
  if (!reference && (p.p50 < 0.25 || p.p50 > 0.7))
    warnings.push(
      "Scene may be intentionally low-key or high-key. Check subject brightness before accepting Auto.",
    );
  if (measured.clipping.highlights > 0.005)
    warnings.push(
      "Some developed channels are already clipped. Tone adjustment cannot reconstruct lost RAW or JPEG detail.",
    );
  if (reference)
    warnings.push(
      "Reference fitting matches tone only. Review subject, color balance, and crop individually.",
    );
  const maximumExposure = isRawFile(file) ? 2 : 1.5;
  const score = (a: PhotoAnalysis, r: Recipe) => {
    const q = a.percentiles;
    const tonal =
      3 * (q.p50 - desired.p50) ** 2 +
      (q.p10 - desired.p10) ** 2 +
      (q.p90 - desired.p90) ** 2 +
      0.5 * (q.p99 - desired.p99) ** 2;
    const clipping =
      4 *
      (Math.max(
        0,
        a.clipping.highlights - measured.clipping.highlights - 0.001,
      ) +
        Math.max(0, a.clipping.shadows - measured.clipping.shadows - 0.001));
    const restraint =
      0.0004 *
      ((r.exposure / maximumExposure) ** 2 +
        (r.contrast / 30) ** 2 +
        (r.highlights / 40) ** 2 +
        (r.shadows / 40) ** 2 +
        (r.whites / 20) ** 2 +
        (r.blacks / 20) ** 2);
    return tonal + clipping + restraint;
  };
  let best = { ...base },
    after = measured,
    bestScore = score(measured, base);
  const consider = async (candidate: Recipe) => {
    const analysis = await analyzePhoto(render, file, candidate),
      value = score(analysis, candidate);
    if (value < bestScore - 1e-7) {
      best = candidate;
      after = analysis;
      bestScore = value;
    }
  };
  const estimate = clamp(
    Math.log2(
      Math.max(0.001, linear(desired.p50)) / Math.max(0.001, linear(p.p50)),
    ),
    -maximumExposure,
    maximumExposure,
  );
  for (const exposure of new Set(
    [estimate * 0.5, estimate, estimate - 0.3, estimate + 0.3].map(
      (e) => Math.round(clamp(e, -maximumExposure, maximumExposure) * 20) / 20,
    ),
  ))
    await consider({ ...base, exposure });
  // Bounded coordinate search, evaluated through the real renderer rather than
  // transplanting slider formulas from another editor. At most 18 small renders.
  for (const [key, step] of [
    ["highlights", 20],
    ["shadows", 20],
    ["contrast", 10],
    ["blacks", 6],
    ["whites", 6],
  ] as const) {
    const current = { ...best };
    await consider({ ...current, [key]: current[key] - step });
    await consider({ ...current, [key]: current[key] + step });
  }
  const patch = Object.fromEntries(
    lightKeys.map((k) => [k, best[k]]),
  ) as Partial<Recipe>;
  return { patch, before, after, warnings, method };
}
