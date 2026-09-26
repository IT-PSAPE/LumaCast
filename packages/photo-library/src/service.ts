import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  realpath,
  stat,
  readdir,
  access,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  neutralRecipe,
  recipeSchema,
  patchSchema,
  type Photo,
  type AppState,
  type EditRequest,
  type Recipe,
  type ExportJob,
} from "@lumacast/photo-model";
import { inspectImage } from "@lumacast/photo-imaging";

import { imageExtensions } from "@lumacast/photo-model";
const extensions = new Set(imageExtensions.map((ext) => `.${ext}`));
const idSchema = z.string().min(1).max(100);
const editSchema = z
  .array(
    z
      .object({
        id: idSchema,
        expectedRevision: z.number().int().nonnegative(),
        patch: patchSchema,
      })
      .strict(),
  )
  .min(1)
  .max(500);
const photoSchema = z.object({
  id: idSchema,
  path: z.string(),
  name: z.string(),
  folder: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  format: z.string(),
  size: z.number().nonnegative(),
  metadata: z.record(z.string(), z.string()).optional(),
  importedAt: z.string(),
  modifiedAt: z.string(),
  rating: z.number().int().min(0).max(5),
  favorite: z.boolean(),
  missing: z.boolean().optional(),
  recipe: recipeSchema,
  revision: z.number().int().nonnegative(),
  history: z.array(recipeSchema),
  future: z.array(recipeSchema),
});
type Catalog = {
  version: 1;
  photos: Photo[];
  selection: string[];
  activity: AppState["activity"];
};
export class PhotoService extends EventEmitter {
  private data: Catalog = {
    version: 1,
    photos: [],
    selection: [],
    activity: [],
  };
  private tail: Promise<unknown> = Promise.resolve();
  readonly jobs: ExportJob[] = [];
  private constructor(readonly catalogPath: string) {
    super();
  }
  static async open(catalogPath: string) {
    const s = new PhotoService(catalogPath);
    await mkdir(path.dirname(catalogPath), { recursive: true });
    try {
      const raw = JSON.parse(await readFile(catalogPath, "utf8"));
      if (raw.version !== 1) throw new Error("Unsupported catalog version");
      s.data = {
        version: 1,
        photos: z.array(photoSchema).parse(raw.photos),
        selection: z.array(idSchema).parse(raw.selection ?? []),
        activity: raw.activity ?? [],
      };
      await Promise.all(
        s.data.photos.map(async (p) => {
          p.missing = !(await access(p.path).then(
            () => true,
            () => false,
          ));
        }),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(`Cannot load catalog: ${(e as Error).message}`);
    }
    return s;
  }
  async idle() {
    await this.tail;
  }
  state(): AppState {
    return structuredClone({ ...this.data, jobs: this.jobs });
  }
  photo(id: string): Photo {
    const p = this.data.photos.find((p) => p.id === id);
    if (!p) throw new Error(`NOT_FOUND: Photo ${id}`);
    return structuredClone(p);
  }
  private mutate<T>(
    action: string,
    source: string,
    fn: (next: Catalog) => T | Promise<T>,
  ): Promise<T> {
    const run = this.tail.then(async () => {
      const next = structuredClone(this.data);
      const result = await fn(next);
      next.activity.unshift({
        id: randomUUID(),
        time: new Date().toISOString(),
        source,
        action,
      });
      next.activity = next.activity.slice(0, 200);
      const temp = `${this.catalogPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
        await rename(temp, this.catalogPath);
      } finally {
        await unlink(temp).catch(() => {});
      }
      this.data = next;
      this.emit("change");
      return result;
    });
    this.tail = run.catch(() => {});
    return run;
  }
  async importPaths(inputs: string[], source = "UI") {
    z.array(z.string().min(1)).min(1).max(500).parse(inputs);
    const candidates: string[] = [];
    const visited = new Set<string>();
    const errors: { path: string; message: string }[] = [];
    const walk = async (input: string, explicit = false): Promise<void> => {
      try {
        const canonical = await realpath(input);
        if (visited.has(canonical)) return;
        visited.add(canonical);
        const info = await stat(canonical);
        if (info.isDirectory()) {
          for (const item of await readdir(canonical, {
            withFileTypes: true,
          })) {
            if (item.isSymbolicLink()) continue;
            await walk(path.join(canonical, item.name));
          }
        } else if (extensions.has(path.extname(canonical).toLowerCase())) {
          if (candidates.length >= 10000)
            throw new Error(
              "Import limit: choose at most 10,000 photos at a time",
            );
          candidates.push(canonical);
        } else if (explicit)
          errors.push({
            path: input,
            message:
              "Unsupported format. Choose JPEG, PNG, WebP, single-page TIFF or camera RAW.",
          });
      } catch (e) {
        errors.push({ path: input, message: (e as Error).message });
      }
    };
    for (const input of inputs) await walk(input, true);
    const inspected: Photo[] = [];
    for (const file of candidates) {
      if (this.data.photos.some((p) => p.path === file)) continue;
      try {
        const info = await inspectImage(file);
        const fileStat = await stat(file);
        inspected.push({
          ...info,
          id: randomUUID(),
          path: file,
          name: path.basename(file),
          folder: path.dirname(file),
          importedAt: new Date().toISOString(),
          modifiedAt: fileStat.mtime.toISOString(),
          rating: 0,
          favorite: false,
          recipe: neutralRecipe(),
          revision: 0,
          history: [],
          future: [],
        });
      } catch (e) {
        errors.push({ path: file, message: (e as Error).message });
      }
    }
    return this.mutate("Import photos", source, (next) => {
      const imported = inspected.filter(
        (p) => !next.photos.some((old) => old.path === p.path),
      );
      next.photos.push(...imported);
      return { imported: imported.map((p) => p.id), errors };
    });
  }
  async edit(requests: EditRequest[], source = "UI") {
    const edits = editSchema.parse(requests);
    if (new Set(edits.map((e) => e.id)).size !== edits.length)
      throw new Error("INVALID_ARGUMENT: Duplicate photo IDs");
    return this.mutate(`Edit ${edits.length} photo(s)`, source, (next) => {
      const targets = edits.map((e) => {
        const p = next.photos.find((p) => p.id === e.id);
        if (!p) throw new Error(`NOT_FOUND: Photo ${e.id}`);
        if (p.revision !== e.expectedRevision)
          throw new Error(
            `CONFLICT: ${p.name} is revision ${p.revision}; reload before editing`,
          );
        const geometry = [
          "rotation",
          "straighten",
          "flipX",
          "flipY",
          "lensProfile",
          "lensDistortion",
          "lensRed",
          "lensBlue",
        ].some(
          (k) =>
            k in e.patch &&
            JSON.stringify(e.patch[k as keyof Recipe]) !==
              JSON.stringify(p.recipe[k as keyof Recipe]),
        );
        const recipe = recipeSchema.parse({
          ...p.recipe,
          ...(geometry ? { crop: null } : {}),
          ...e.patch,
        });
        return { p, recipe };
      });
      return targets.map(({ p, recipe }) => {
        p.history.push(p.recipe);
        p.history = p.history.slice(-100);
        p.future = [];
        p.recipe = recipe;
        p.revision++;
        return { id: p.id, revision: p.revision };
      });
    });
  }
  async history(
    id: string,
    expectedRevision: number,
    direction: "undo" | "redo",
    source = "UI",
  ) {
    z.number().int().nonnegative().parse(expectedRevision);
    z.enum(["undo", "redo"]).parse(direction);
    return this.mutate(direction, source, (next) => {
      const p = next.photos.find((p) => p.id === id);
      if (!p) throw new Error("NOT_FOUND: Photo");
      if (p.revision !== expectedRevision)
        throw new Error("CONFLICT: Reload the photo before changing history");
      const from = direction === "undo" ? p.history : p.future;
      const to = direction === "undo" ? p.future : p.history;
      const recipe = from.pop();
      if (!recipe) throw new Error(`EMPTY_HISTORY: Nothing to ${direction}`);
      to.push(p.recipe);
      p.recipe = recipe;
      p.revision++;
      return { id, revision: p.revision };
    });
  }
  async metadata(
    id: string,
    patch: { rating?: number; favorite?: boolean },
    source = "UI",
  ) {
    const valid = z
      .object({
        rating: z.number().int().min(0).max(5).optional(),
        favorite: z.boolean().optional(),
      })
      .strict()
      .parse(patch);
    return this.mutate("Update photo metadata", source, (next) => {
      const p = next.photos.find((p) => p.id === id);
      if (!p) throw new Error("NOT_FOUND: Photo");
      Object.assign(p, valid);
    });
  }
  async select(ids: string[], source = "UI") {
    z.array(idSchema).max(10000).parse(ids);
    return this.mutate("Change selection", source, (next) => {
      if (ids.some((id) => !next.photos.some((p) => p.id === id)))
        throw new Error("NOT_FOUND: Selection contains missing photo");
      next.selection = [...new Set(ids)];
    });
  }
  async relink(id: string, newPath: string) {
    const canonical = await realpath(newPath);
    const info = await inspectImage(canonical);
    return this.mutate("Relink original", "UI", (next) => {
      const p = next.photos.find((p) => p.id === id);
      if (!p) throw new Error("NOT_FOUND: Photo");
      if (next.photos.some((q) => q.id !== id && q.path === canonical))
        throw new Error(
          "ALREADY_IMPORTED: That original belongs to another photo",
        );
      Object.assign(p, info, {
        path: canonical,
        name: path.basename(canonical),
        folder: path.dirname(canonical),
        missing: false,
      });
      p.history.push(p.recipe);
      p.recipe = { ...p.recipe, crop: null };
      p.future = [];
      p.revision++;
    });
  }
}
