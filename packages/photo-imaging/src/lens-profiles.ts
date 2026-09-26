import database from "./lensfun/profiles.json";
import { lensProfileSchema, type LensProfile } from "@lumacast/photo-model";
type Sample = { model: string; focal: number; [key: string]: string | number };
type Lens = {
  id: string;
  maker: string;
  models: string[];
  mounts: string[];
  crop: number;
  aspect: number;
  distortion: Sample[];
  tca: Sample[];
  vignetting: Sample[];
};
const db = database as unknown as {
  revision: string;
  cameras: { maker: string; models: string[]; crop: number; mount: string }[];
  lenses: Lens[];
};
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(
      /\b(canon|nikon|sony|corporation|inc\.?|fujifilm|olympus|panasonic)\b/g,
      "",
    )
    .replace(/[^a-z0-9.]/g, "");
const number = (s?: string) =>
  s ? Number(s.replace(/^f\//, "").match(/[\d.]+/)?.[0]) : NaN;
function interpolate(samples: Sample[], focal: number): Sample | null {
  const sorted = [...samples].sort((a, b) => a.focal - b.focal);
  const exact = sorted.find((s) => Math.abs(s.focal - focal) < 0.05);
  if (exact) return exact;
  const lo = sorted.filter((s) => s.focal < focal).at(-1),
    hi = sorted.find((s) => s.focal > focal);
  if (!lo || !hi || lo.model !== hi.model) return null;
  const t = (focal - lo.focal) / (hi.focal - lo.focal);
  const result: Sample = { model: lo.model, focal };
  for (const key of new Set([...Object.keys(lo), ...Object.keys(hi)])) {
    if (key === "model" || key === "focal") continue;
    const fallback = ["kr", "kb", "vr", "vb"].includes(key) ? 1 : 0;
    result[key] =
      Number(lo[key] ?? fallback) * (1 - t) + Number(hi[key] ?? fallback) * t;
  }
  return result;
}
export function matchLensProfile(metadata: Record<string, string>): {
  profile: LensProfile | null;
  message: string;
  warnings: string[];
} {
  const fail = (message: string) => ({ profile: null, message, warnings: [] });
  const name = metadata.Lens,
    camera = metadata.Camera,
    focal = number(metadata["Focal length"]);
  if (!name || !camera || !Number.isFinite(focal) || focal <= 0)
    return fail(
      "Camera, lens name, and focal length are required. This file does not provide enough metadata for automatic correction.",
    );
  const cameraMatches = db.cameras.filter((c) =>
    c.models.some((m) => norm(m) === norm(camera)),
  );
  if (!cameraMatches.length)
    return fail(
      `No calibrated camera match for ${camera}. Manual correction remains available.`,
    );
  const crop = cameraMatches[0].crop;
  if (cameraMatches.some((c) => c.crop !== crop))
    return fail(
      "Camera metadata matches multiple sensor sizes; no correction was applied.",
    );
  // Exact normalized model names only. Never guess a lens from focal length alone.
  const matches = db.lenses.filter(
    (l) =>
      l.models.some((m) => norm(m) === norm(name)) &&
      l.crop <= crop * 1.01 &&
      cameraMatches.some((c) => l.mounts.includes(c.mount)),
  );
  const supported = matches
    .map((l) => ({
      l,
      d: interpolate(l.distortion, focal),
      t: interpolate(l.tca, focal),
    }))
    .filter((x) => x.d || x.t)
    .sort((a, b) => b.l.crop - a.l.crop);
  if (!supported.length)
    return fail(
      `No supported Lensfun calibration for ${name} at ${focal} mm on this camera. Manual correction remains available.`,
    );
  const { l, d, t } = supported[0];
  if (
    supported.length > 1 &&
    supported[1].l.crop === l.crop &&
    JSON.stringify([supported[1].d, supported[1].t]) !== JSON.stringify([d, t])
  )
    return fail(
      "Multiple lens calibrations match this metadata; no correction was applied.",
    );
  const warnings: string[] = [];
  if (!d) warnings.push("No distortion calibration at this focal length.");
  if (!t)
    warnings.push("No chromatic-aberration calibration at this focal length.");
  const val = (s: Sample, k: string, fallback = 0) => Number(s[k] ?? fallback);
  // Only use shading when aperture is calibrated and focus distance is known,
  // or every distance has identical coefficients. No guessed infinity focus.
  const aperture = number(metadata.Aperture),
    distance = number(metadata["Focus distance"]);
  const shading = l.vignetting.filter(
    (s) => Math.abs(Number(s.aperture) - aperture) < 0.05,
  );
  let v: Sample | null = null;
  if (shading.length) {
    const distances = [...new Set(shading.map((s) => Number(s.distance)))];
    const groups = distances
      .map((distance) =>
        interpolate(
          shading.filter((s) => Number(s.distance) === distance),
          focal,
        ),
      )
      .filter((s): s is Sample => !!s);
    v =
      groups.find(
        (s) =>
          Number.isFinite(distance) &&
          Math.abs(Number(s.distance) - distance) <
            Math.max(0.1, distance * 0.05),
      ) ?? null;
    if (
      !v &&
      groups.length > 1 &&
      groups.every((s) =>
        ["k1", "k2", "k3"].every((k) => s[k] === groups[0][k]),
      )
    )
      v = groups[0];
  }
  if (!v)
    warnings.push(
      "Corner illumination needs matching aperture/focus calibration; use the manual control if needed.",
    );
  const profile = lensProfileSchema.parse({
    id: l.id,
    name: l.models[0],
    source: "Lensfun",
    revision: db.revision,
    cameraCrop: crop,
    calibrationCrop: l.crop,
    aspect: l.aspect,
    focal,
    distortion: d
      ? {
          model: d.model,
          terms:
            d.model === "ptlens"
              ? [val(d, "a"), val(d, "b"), val(d, "c")]
              : [val(d, "k1"), val(d, "k2"), 0],
        }
      : null,
    tca: t
      ? {
          model: t.model,
          terms:
            t.model === "linear"
              ? [0, 0, val(t, "kr", 1), 0, 0, val(t, "kb", 1)]
              : [
                  val(t, "br"),
                  val(t, "cr"),
                  val(t, "vr", 1),
                  val(t, "bb"),
                  val(t, "cb"),
                  val(t, "vb", 1),
                ],
        }
      : null,
    vignette: v ? [val(v, "k1"), val(v, "k2"), val(v, "k3")] : null,
  });
  return {
    profile,
    message: `${profile.name} · ${focal} mm · Lensfun`,
    warnings,
  };
}
export const lensDatabaseInfo = {
  source: "Lensfun",
  revision: db.revision,
  lenses: db.lenses.length,
  cameras: db.cameras.length,
};
