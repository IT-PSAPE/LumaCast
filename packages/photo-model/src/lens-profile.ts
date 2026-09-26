import { z } from "zod";
const term = z.number().finite().min(-20).max(20);
const triple = z.tuple([term, term, term]);
// Calibration snapshots travel with recipes so database updates cannot change existing edits.
export const lensProfileSchema = z
  .object({
    id: z.string().min(1).max(160),
    name: z.string().min(1).max(300),
    source: z.literal("Lensfun"),
    revision: z.string().max(64),
    cameraCrop: z.number().min(0.1).max(20),
    calibrationCrop: z.number().min(0.1).max(20),
    aspect: z.number().min(1).max(3),
    focal: z.number().positive().max(5000),
    distortion: z
      .object({ model: z.enum(["poly3", "poly5", "ptlens"]), terms: triple })
      .strict()
      .nullable(),
    tca: z
      .object({
        model: z.enum(["linear", "poly3"]),
        terms: z.tuple([term, term, term, term, term, term]),
      })
      .strict()
      .nullable(),
    vignette: triple.nullable(),
  })
  .strict();
export type LensProfile = z.infer<typeof lensProfileSchema>;
