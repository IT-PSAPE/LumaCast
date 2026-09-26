import { correctProfile } from "./profile-render.js";
import { correctLens } from "./lens.js";
import { denoise } from "./denoise.js";
import { isRawFile } from "@lumacast/photo-model";
import { decodeRaw } from "./raw.js";
import sharp, { type OutputInfo } from "sharp";
import { ByteCache } from "./cache.js";
type RawImage = { data: Buffer; info: OutputInfo };
const sourceCache = new ByteCache<RawImage>(64 * 1024 * 1024);
const noiseCache = new ByteCache<Buffer>(16 * 1024 * 1024);
const geometryCache = new ByteCache<RawImage>(32 * 1024 * 1024);
import exifReader from "exif-reader";
import { stat } from "node:fs/promises";
import { z } from "zod";
import {
  recipeSchema,
  type Recipe,
  type RenderOptions,
  type ImageInfo,
} from "@lumacast/photo-model";
const MAX_PIXELS = 80_000_000;
/**
 * The render port every consumer depends on. Declared here rather than in the
 * library so `@lumacast/photo-imaging` stays below `@lumacast/photo-library`:
 * anything that renders a photo satisfies this signature.
 */
export type Renderer = (
  file: string,
  recipe: Recipe,
  options?: RenderOptions,
) => Promise<Buffer>;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const linear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const gamma = (v: number) =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
async function metadata(file: string) {
  const meta = await sharp(file, {
    limitInputPixels: MAX_PIXELS,
    failOn: "error",
  }).metadata();
  if (!["jpeg", "png", "webp", "tiff"].includes(meta.format ?? ""))
    throw new Error("Unsupported format: choose JPEG, PNG, WebP, or TIFF");
  if ((meta.pages ?? 1) > 1)
    throw new Error("Unsupported: multi-page or animated image");
  if (!meta.width || !meta.height || meta.width * meta.height > MAX_PIXELS)
    throw new Error(
      "Image exceeds 80 million pixel limit or has invalid dimensions",
    );
  return meta;
}
export async function inspectImage(file: string): Promise<ImageInfo> {
  if (isRawFile(file)) {
    const raw = await decodeRaw(file);
    return {
      width: raw.width,
      height: raw.height,
      format: file.split(".").pop()!.toLowerCase(),
      size: (await stat(file)).size,
      metadata: raw.metadata,
    };
  }
  const m = await metadata(file);
  const s = await stat(file);
  const swap = [5, 6, 7, 8].includes(m.orientation ?? 1);
  const camera: Record<string, string> = {};
  if (m.exif) {
    try {
      const exif = exifReader(m.exif);
      const image = exif.Image,
        photo = exif.Photo;
      if (image?.Make || image?.Model)
        camera.Camera = [image?.Make, image?.Model].filter(Boolean).join(" ");
      if (photo?.LensModel) camera.Lens = photo.LensModel;
      if (image?.Make) camera["Camera make"] = image.Make;
      if (image?.Model) camera["Camera model"] = image.Model;
      if (image?.Software) camera.Software = image.Software;
      if (photo?.SubjectDistance && Number.isFinite(photo.SubjectDistance))
        camera["Focus distance"] = `${photo.SubjectDistance} m`;
      if (photo?.ExposureTime)
        camera.Shutter =
          photo.ExposureTime < 1
            ? `1/${Math.round(1 / photo.ExposureTime)} s`
            : `${photo.ExposureTime} s`;
      if (photo?.FNumber) camera.Aperture = `f/${photo.FNumber}`;
      if (photo?.ISOSpeedRatings) camera.ISO = String(photo.ISOSpeedRatings);
      if (photo?.FocalLength)
        camera["Focal length"] = `${photo.FocalLength} mm`;
      if (photo?.DateTimeOriginal)
        camera.Captured = photo.DateTimeOriginal.toISOString();
    } catch {
      /* Malformed optional EXIF must not prevent opening a valid raster. */
    }
  }

  return {
    width: swap ? m.height! : m.width!,
    height: swap ? m.width! : m.height!,
    format: m.format!,
    size: s.size,
    metadata: {
      ...camera,
      "Color space": m.space,
      "Bit depth": String(m.bitsPerSample ?? 8),
      ...(m.density ? { Density: `${m.density} DPI` } : {}),
    },
  };
}
function pixels(data: Buffer, width: number, height: number, r: Recipe) {
  const exposure = 2 ** r.exposure;
  const hue = r.hue;
  // Input channels are bytes: this table is exactly equivalent to six power operations per pixel.
  const exposed = Float64Array.from({ length: 256 }, (_, i) =>
    gamma(linear(i / 255) * exposure),
  );
  if (
    ![
      r.highlights,
      r.shadows,
      r.whites,
      r.blacks,
      r.hue,
      r.saturation,
      r.vibrance,
      r.vignette,
    ].some(Boolean)
  ) {
    const channel = (temperature: number, tint: number) =>
      Uint8Array.from(exposed, (v) =>
        Math.round(
          clamp(
            (v - 0.5) * (1 + r.contrast / 100) +
              0.5 +
              r.brightness / 200 +
              temperature +
              tint,
          ) * 255,
        ),
      );
    const red = channel(r.temperature / 1000, r.tint / 2000),
      green = channel(0, -r.tint / 1000),
      blue = channel(-r.temperature / 1000, r.tint / 2000);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = red[data[i]];
      data[i + 1] = green[data[i + 1]];
      data[i + 2] = blue[data[i + 2]];
    }
    return data;
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let red = exposed[data[i]],
        green = exposed[data[i + 1]],
        blue = exposed[data[i + 2]];
      const contrast = 1 + r.contrast / 100;
      red = (red - 0.5) * contrast + 0.5 + r.brightness / 200;
      green = (green - 0.5) * contrast + 0.5 + r.brightness / 200;
      blue = (blue - 0.5) * contrast + 0.5 + r.brightness / 200;
      const lum = clamp(0.2126 * red + 0.7152 * green + 0.0722 * blue);
      const lift =
        (r.highlights * Math.max(0, 2 * lum - 1) +
          r.shadows * Math.max(0, 1 - 2 * lum) +
          r.whites * lum ** 4 +
          r.blacks * (1 - lum) ** 4) /
        200;
      red = clamp(red + lift + r.temperature / 1000 + r.tint / 2000);
      green = clamp(green + lift - r.tint / 1000);
      blue = clamp(blue + lift - r.temperature / 1000 + r.tint / 2000);
      if (hue !== 0) {
        const max = Math.max(red, green, blue),
          min = Math.min(red, green, blue),
          delta = max - min;
        if (delta > 0) {
          let h =
            max === red
              ? ((green - blue) / delta) % 6
              : max === green
                ? (blue - red) / delta + 2
                : (red - green) / delta + 4;
          h = (((h * 60 + hue) % 360) + 360) % 360;
          const chroma = delta,
            secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
          const rgb =
            h < 60
              ? [chroma, secondary, 0]
              : h < 120
                ? [secondary, chroma, 0]
                : h < 180
                  ? [0, chroma, secondary]
                  : h < 240
                    ? [0, secondary, chroma]
                    : h < 300
                      ? [secondary, 0, chroma]
                      : [chroma, 0, secondary];
          [red, green, blue] = rgb.map((v) => v + min);
        }
      }
      const gray = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const saturation =
        (1 + r.saturation / 100) *
        (1 +
          (r.vibrance / 100) *
            (1 - (Math.max(red, green, blue) - Math.min(red, green, blue))));
      const dx = (x + 0.5 - width / 2) / (width / 2),
        dy = (y + 0.5 - height / 2) / (height / 2);
      const vignette =
        1 - (r.vignette / 100) * 0.8 * Math.min(1, (dx * dx + dy * dy) / 2);
      data[i] = Math.round(
        clamp(gray + (red - gray) * saturation) * vignette * 255,
      );
      data[i + 1] = Math.round(
        clamp(gray + (green - gray) * saturation) * vignette * 255,
      );
      data[i + 2] = Math.round(
        clamp(gray + (blue - gray) * saturation) * vignette * 255,
      );
    }
  return data;
}
export async function renderImage(
  file: string,
  recipe: Recipe,
  options: RenderOptions = {},
): Promise<Buffer> {
  if (!isRawFile(file)) await metadata(file);
  const r = recipeSchema.parse(recipe);
  const opts = z
    .object({
      preview: z.boolean().optional(),
      maxDimension: z.number().int().min(16).max(20000).optional(),
      format: z.enum(["jpeg", "png", "webp"]).optional(),
      quality: z.number().int().min(1).max(100).optional(),
    })
    .strict()
    .parse(options);
  const fileStat = opts.preview ? await stat(file) : undefined;
  const stamp = fileStat
    ? `${file}:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`
    : "";
  const key = JSON.stringify([
    stamp,
    opts.maxDimension,
    r.rotation,
    r.straighten,
    r.flipX,
    r.flipY,
    r.crop,
    r.lensProfile,
    r.lensDistortion,
    r.lensVignette,
    r.lensRed,
    r.lensBlue,
  ]);
  let rendered = opts.preview ? geometryCache.get(key) : undefined;
  if (!rendered) {
    rendered = await prepare(file, r, opts, stamp);
    if (opts.preview)
      geometryCache.set(key, rendered, rendered.data.byteLength);
  }
  let clean = rendered.data;
  if (r.noiseLuminance || r.noiseColor) {
    const noiseKey = `${key}:${r.noiseLuminance}:${r.noiseColor}`;
    const cached = opts.preview ? noiseCache.get(noiseKey) : undefined;
    clean =
      cached ??
      denoise(
        rendered.data,
        rendered.info.width,
        rendered.info.height,
        r.noiseLuminance,
        r.noiseColor,
      );
    if (opts.preview && !cached)
      noiseCache.set(noiseKey, clean, clean.byteLength);
  }
  let output = sharp(
    pixels(Buffer.from(clean), rendered.info.width, rendered.info.height, r),
    { raw: rendered.info },
  );
  if (r.sharpening > 0)
    output = output.sharpen({ sigma: 0.5 + (r.sharpening / 100) * 1.5 });
  if (opts.format === "jpeg")
    return output
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: opts.quality ?? 90, chromaSubsampling: "4:4:4" })
      .toBuffer();
  if (opts.format === "webp")
    return output.webp({ quality: opts.quality ?? 90 }).toBuffer();
  return output.png().toBuffer();
}

async function prepare(
  file: string,
  r: Recipe,
  opts: RenderOptions,
  stamp: string,
): Promise<RawImage> {
  // Materialize separate geometry stages: Sharp applies only the last rotation within a pipeline.
  // Keep enough source pixels for the requested crop and inward rotation. Full-size
  // viewing and export bypass downsampling. Both caches are byte-bounded per worker.
  const edge = Math.ceil(
    Math.max(
      512,
      ((opts.maxDimension ?? 1600) * 2) /
        Math.min(r.crop?.width ?? 1, r.crop?.height ?? 1),
    ),
  );
  const sourceKey = `${stamp}:${edge}`;
  let raw = opts.preview ? sourceCache.get(sourceKey) : undefined;
  if (!raw) {
    const cameraRaw = isRawFile(file) ? await decodeRaw(file) : undefined;
    let decoded = (
      cameraRaw
        ? sharp(cameraRaw.data, {
            raw: {
              width: cameraRaw.width,
              height: cameraRaw.height,
              channels: 3,
            },
          })
        : sharp(file, { limitInputPixels: MAX_PIXELS, failOn: "error" })
    )
      .autoOrient()
      .toColourspace("srgb")
      .ensureAlpha();
    if (opts.preview && edge < 20000)
      decoded = decoded.resize({
        width: edge,
        height: edge,
        fit: "inside",
        withoutEnlargement: true,
      });
    raw = await decoded.raw().toBuffer({ resolveWithObject: true });
    if (opts.preview) sourceCache.set(sourceKey, raw, raw.data.byteLength);
  }
  if (r.lensProfile)
    raw = {
      ...raw,
      data: correctProfile(
        raw.data,
        raw.info.width,
        raw.info.height,
        r.lensProfile,
      ),
    };
  raw = {
    ...raw,
    data: correctLens(raw.data, raw.info.width, raw.info.height, r),
  };
  let pipeline = sharp(raw.data, { raw: raw.info });
  if (r.rotation) {
    raw = await pipeline
      .rotate(r.rotation * 90)
      .raw()
      .toBuffer({ resolveWithObject: true });
    pipeline = sharp(raw.data, { raw: raw.info });
  }
  if (r.straighten) {
    const { width: w, height: h } = raw.info;
    const angle = (Math.abs(r.straighten) * Math.PI) / 180;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const scale = Math.min(w / (w * c + h * s), h / (w * s + h * c));
    const width = Math.max(1, Math.floor(w * scale) - 2);
    const height = Math.max(1, Math.floor(h * scale) - 2);
    raw = await pipeline
      .rotate(r.straighten, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    raw = await sharp(raw.data, { raw: raw.info })
      .extract({
        left: Math.floor((raw.info.width - width) / 2),
        top: Math.floor((raw.info.height - height) / 2),
        width,
        height,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    pipeline = sharp(raw.data, { raw: raw.info });
  }
  if (r.flipX || r.flipY) {
    if (r.flipX) pipeline = pipeline.flop();
    if (r.flipY) pipeline = pipeline.flip();
    raw = await pipeline.raw().toBuffer({ resolveWithObject: true });
    pipeline = sharp(raw.data, { raw: raw.info });
  }
  if (r.crop) {
    const c = r.crop;
    const left = Math.min(raw.info.width - 1, Math.floor(c.x * raw.info.width));
    const top = Math.min(
      raw.info.height - 1,
      Math.floor(c.y * raw.info.height),
    );
    const width = Math.max(
      1,
      Math.min(raw.info.width - left, Math.round(c.width * raw.info.width)),
    );
    const height = Math.max(
      1,
      Math.min(raw.info.height - top, Math.round(c.height * raw.info.height)),
    );
    pipeline = pipeline.extract({ left, top, width, height });
  }
  if (opts.maxDimension)
    pipeline = pipeline.resize({
      width: opts.maxDimension,
      height: opts.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });
  return pipeline.raw().toBuffer({ resolveWithObject: true });
}
