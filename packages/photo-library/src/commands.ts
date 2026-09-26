import { analyzePhoto, suggestAutoTone } from "@lumacast/photo-imaging";
import { inspectImage } from "@lumacast/photo-imaging";
import { matchLensProfile } from "@lumacast/photo-imaging";
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { imageExtensions } from "@lumacast/photo-model";
import { z } from "zod";
import { PhotoService } from "./service.js";
import { ExportManager, type Renderer } from "./export.js";
import { neutralRecipe, recipeSchema, patchSchema } from "@lumacast/photo-model";
const id = z.string().min(1);
const rev = z.number().int().nonnegative();
export class Commands {
  readonly exports: ExportManager;
  constructor(
    readonly service: PhotoService,
    readonly render: Renderer,
  ) {
    this.exports = new ExportManager(service, render);
  }
  async run(name: string, args: unknown = {}, source = "UI"): Promise<unknown> {
    switch (name) {
      case "browse_folder": {
        if (source !== "UI")
          throw new Error(
            "Folder browsing is available in the desktop UI only",
          );
        const directory = await realpath(
          z
            .object({ path: z.string().min(1) })
            .strict()
            .parse(args).path,
        );
        const entries = await readdir(directory, { withFileTypes: true });
        const item = (entry: { name: string }) => ({
          name: entry.name,
          path: path.join(directory, entry.name),
        });
        return {
          path: directory,
          parent: path.dirname(directory),
          folders: entries
            .filter((e) => e.isDirectory() && !e.name.startsWith("."))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(item),
          files: entries
            .filter(
              (e) =>
                e.isFile() &&
                imageExtensions.includes(
                  path.extname(e.name).slice(1).toLowerCase(),
                ),
            )
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(item),
        };
      }
      case "get_lens_match":
      case "auto_lens_correction": {
        const a = (
          name === "auto_lens_correction"
            ? z.object({ id, expectedRevision: rev })
            : z.object({ id })
        )
          .strict()
          .parse(args);
        const photo = this.service.photo(a.id);
        if ("expectedRevision" in a && photo.revision !== a.expectedRevision)
          throw new Error(
            "REVISION_CONFLICT: Photo changed; re-read it before applying Auto.",
          );
        const info = await inspectImage(photo.path);
        const result = matchLensProfile(info.metadata ?? {});
        if (info.format === "jpeg" || info.format === "png")
          result.warnings.push(
            "Rendered files may already include lens correction. Compare before/after to avoid double correction.",
          );
        if (name === "auto_lens_correction" && result.profile) {
          await this.service.edit(
            [
              {
                id: photo.id,
                expectedRevision: photo.revision,
                patch: { lensProfile: result.profile },
              },
            ],
            source,
          );
        }
        return {
          ...result,
          applied: name === "auto_lens_correction" && !!result.profile,
        };
      }
      case "analyze_photo": {
        const a = z.object({ id }).strict().parse(args),
          photo = this.service.photo(a.id);
        return {
          id: photo.id,
          revision: photo.revision,
          format: photo.format,
          metadata: photo.metadata,
          analysis: await analyzePhoto(this.render, photo.path, photo.recipe),
        };
      }
      case "suggest_adjustments":
      case "auto_adjust": {
        const a = (
          name === "auto_adjust"
            ? z.object({
                id,
                expectedRevision: rev,
                referenceId: id.optional(),
              })
            : z.object({ id, referenceId: id.optional() })
        )
          .strict()
          .parse(args);
        const photo = this.service.photo(a.id);
        if ("expectedRevision" in a && photo.revision !== a.expectedRevision)
          throw new Error(
            "REVISION_CONFLICT: Photo changed; re-read it before applying Auto.",
          );
        if (a.referenceId === a.id)
          throw new Error(
            "INVALID_REFERENCE: Choose a different reference photo.",
          );
        const reference = a.referenceId
          ? this.service.photo(a.referenceId)
          : undefined;
        const result = await suggestAutoTone(
          this.render,
          photo.path,
          photo.recipe,
          reference
            ? { file: reference.path, recipe: reference.recipe }
            : undefined,
        );
        if (
          reference &&
          this.service.photo(reference.id).revision !== reference.revision
        )
          throw new Error(
            "REVISION_CONFLICT: Reference changed during analysis.",
          );
        if (name === "auto_adjust")
          await this.service.edit(
            [
              {
                id: photo.id,
                expectedRevision: photo.revision,
                patch: result.patch,
              },
            ],
            source,
          );
        return {
          id: photo.id,
          expectedRevision: photo.revision,
          referenceId: reference?.id,
          referenceRevision: reference?.revision,
          ...result,
        };
      }
      case "get_app_state":
        return this.service.state();
      case "get_photo":
        return this.service.photo(z.object({ id }).parse(args).id);
      case "get_selection":
        return this.service.state().selection;
      case "import_photos":
        return this.service.importPaths(
          z
            .object({ paths: z.array(z.string()).min(1).max(500) })
            .strict()
            .parse(args).paths,
          source,
        );
      case "set_selection":
        return this.service.select(
          z
            .object({ ids: z.array(id) })
            .strict()
            .parse(args).ids,
          source,
        );
      case "update_metadata": {
        const a = z
          .object({
            id,
            rating: z.number().int().min(0).max(5).optional(),
            favorite: z.boolean().optional(),
          })
          .strict()
          .parse(args);
        const { id: photoId, ...patch } = a;
        return this.service.metadata(photoId, patch, source);
      }
      case "apply_edits": {
        const a = z
          .object({ id, expectedRevision: rev, patch: patchSchema })
          .strict()
          .parse(args);
        return this.service.edit([a], source);
      }
      case "apply_batch_edits": {
        const a = z
          .object({
            edits: z
              .array(
                z
                  .object({ id, expectedRevision: rev, patch: patchSchema })
                  .strict(),
              )
              .min(1)
              .max(500),
          })
          .strict()
          .parse(args);
        return this.service.edit(a.edits, source);
      }
      case "reset_edits": {
        const a = z.object({ id, expectedRevision: rev }).strict().parse(args);
        return this.service.edit([{ ...a, patch: neutralRecipe() }], source);
      }
      case "undo":
      case "redo": {
        const a = z.object({ id, expectedRevision: rev }).strict().parse(args);
        return this.service.history(a.id, a.expectedRevision, name, source);
      }
      case "relink": {
        const a = z.object({ id, path: z.string() }).strict().parse(args);
        return this.service.relink(a.id, a.path);
      }
      case "export_photos":
        return this.exports.start(args as any);
      case "get_export_job":
        return this.exports.get(z.object({ id }).parse(args).id);
      case "cancel_export_job":
        return this.exports.cancel(z.object({ id }).parse(args).id);
      default:
        throw new Error(`UNKNOWN_COMMAND: ${name}`);
    }
  }
  async preview(id: string, recipe?: unknown, maxDimension = 1600) {
    const photo = this.service.photo(id);
    return this.render(
      photo.path,
      recipe === undefined ? photo.recipe : recipeSchema.parse(recipe),
      {
        maxDimension: z.number().int().min(64).max(20000).parse(maxDimension),
        format: "jpeg",
        quality: 88,
        preview: maxDimension < 20000,
      },
    );
  }
}
