import { z } from "zod";
import { lensProfileSchema } from "./lens-profile.js";

export const adjustmentControls = [
  ["exposure", "Exposure", -5, 5, 0.05, "Light"],
  ["brightness", "Brightness", -100, 100, 1, "Light"],
  ["contrast", "Contrast", -100, 100, 1, "Light"],
  ["highlights", "Highlights", -100, 100, 1, "Light"],
  ["shadows", "Shadows", -100, 100, 1, "Light"],
  ["whites", "Whites", -100, 100, 1, "Light"],
  ["blacks", "Blacks", -100, 100, 1, "Light"],
  ["temperature", "Temperature", -100, 100, 1, "Color"],
  ["tint", "Tint", -100, 100, 1, "Color"],
  ["hue", "Hue", -180, 180, 1, "Color"],
  ["saturation", "Saturation", -100, 100, 1, "Color"],
  ["vibrance", "Vibrance", -100, 100, 1, "Color"],
  ["noiseLuminance", "Luminance noise", 0, 100, 1, "Detail"],
  ["noiseColor", "Color noise", 0, 100, 1, "Detail"],
  ["lensDistortion", "Distortion", -100, 100, 1, "Lens correction"],
  ["lensVignette", "Corner illumination", 0, 100, 1, "Lens correction"],
  ["lensRed", "Red / cyan fringe", -100, 100, 1, "Lens correction"],
  ["lensBlue", "Blue / yellow fringe", -100, 100, 1, "Lens correction"],
  ["sharpening", "Sharpening", 0, 100, 1, "Detail"],
  ["vignette", "Vignette", 0, 100, 1, "Detail"],
] as const;
const signed = z.number().finite().min(-100).max(100);
export const cropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine(
    (c) => c.x + c.width <= 1.000001 && c.y + c.height <= 1.000001,
    "Crop must fit inside image",
  );
export const recipeSchema = z
  .object({
    exposure: z.number().finite().min(-5).max(5).default(0),
    brightness: signed.default(0),
    contrast: signed.default(0),
    highlights: signed.default(0),
    shadows: signed.default(0),
    whites: signed.default(0),
    blacks: signed.default(0),
    temperature: signed.default(0),
    tint: signed.default(0),
    hue: z.number().finite().min(-180).max(180).default(0),
    saturation: signed.default(0),
    vibrance: signed.default(0),
    noiseLuminance: z.number().min(0).max(100).default(0),
    noiseColor: z.number().min(0).max(100).default(0),
    lensProfile: lensProfileSchema.nullable().default(null),
    lensDistortion: signed.default(0),
    lensVignette: z.number().min(0).max(100).default(0),
    lensRed: signed.default(0),
    lensBlue: signed.default(0),
    sharpening: z.number().min(0).max(100).default(0),
    vignette: z.number().min(0).max(100).default(0),
    rotation: z.number().int().min(0).max(3).default(0),
    straighten: z.number().min(-45).max(45).default(0),
    flipX: z.boolean().default(false),
    flipY: z.boolean().default(false),
    crop: cropSchema.nullable().default(null),
  })
  .strict();
// Remove field defaults before making a patch: Zod v4 applies defaults inside optional fields.
type PatchShape = {
  [K in keyof typeof recipeSchema.shape]: z.ZodOptional<
    ReturnType<(typeof recipeSchema.shape)[K]["removeDefault"]>
  >;
};
const patchShape = Object.fromEntries(
  Object.entries(recipeSchema.shape).map(([key, value]) => [
    key,
    value.removeDefault().optional(),
  ]),
) as PatchShape;
export const patchSchema = z.object(patchShape).strict();
export type Recipe = z.infer<typeof recipeSchema>;
export const neutralRecipe = (): Recipe => recipeSchema.parse({});
export type AdjustmentKey = (typeof adjustmentControls)[number][0];
export type ImageInfo = {
  width: number;
  height: number;
  format: string;
  size: number;
  metadata?: Record<string, string>;
};
export type Photo = ImageInfo & {
  id: string;
  path: string;
  name: string;
  folder: string;
  importedAt: string;
  modifiedAt: string;
  rating: number;
  favorite: boolean;
  missing?: boolean;
  recipe: Recipe;
  revision: number;
  history: Recipe[];
  future: Recipe[];
};
export type EditRequest = {
  id: string;
  expectedRevision: number;
  patch: Partial<Recipe>;
};
export type ExportOptions = {
  ids: string[];
  directory: string;
  format: "jpeg" | "png" | "webp";
  quality: number;
  maxDimension?: number;
  suffix: string;
};
export type ExportJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  done: number;
  outputs: string[];
  errors: { id: string; message: string }[];
  createdAt: string;
};
export type Activity = {
  id: string;
  time: string;
  source: string;
  action: string;
};
export type AppState = {
  photos: Photo[];
  selection: string[];
  jobs: ExportJob[];
  activity: Activity[];
};
export type AgentSettings = {
  enabled: boolean;
  roots: string[];
  endpoint?: string;
  configPath: string;
  clientConfig: string;
};
export type RenderOptions = {
  /** Screen previews may use a bounded, downsampled source cache. Exports never do. */
  preview?: boolean;
  maxDimension?: number;
  format?: "jpeg" | "png" | "webp";
  quality?: number;
};
