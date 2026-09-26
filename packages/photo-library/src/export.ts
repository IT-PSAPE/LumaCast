import { randomUUID } from "node:crypto";
import { realpath, stat, writeFile, link, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { PhotoService } from "./service.js";
import type { ExportOptions, ExportJob } from "@lumacast/photo-model";
// The render contract is imaging's; the library only consumes it, so it is
// re-exported here rather than declared a second time.
import type { Renderer } from "@lumacast/photo-imaging";
export type { Renderer } from "@lumacast/photo-imaging";
export const exportSchema = z
  .object({
    ids: z.array(z.string()).min(1).max(500),
    directory: z.string().min(1),
    format: z.enum(["jpeg", "png", "webp"]).default("jpeg"),
    quality: z.number().int().min(1).max(100).default(90),
    maxDimension: z.number().int().min(16).max(20000).optional(),
    suffix: z
      .string()
      .max(80)
      .regex(/^[\w .-]*$/)
      .default("-edited"),
  })
  .strict();
export class ExportManager {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private service: PhotoService,
    private render: Renderer,
  ) {}
  async start(input: ExportOptions) {
    const opts = exportSchema.parse(input);
    const directory = await realpath(opts.directory);
    if (!(await stat(directory)).isDirectory())
      throw new Error("INVALID_DIRECTORY: Choose a folder");
    const photos = [...new Set(opts.ids)].map((id) => this.service.photo(id));
    const job: ExportJob = {
      id: randomUUID(),
      status: "queued",
      total: photos.length,
      done: 0,
      outputs: [],
      errors: [],
      createdAt: new Date().toISOString(),
    };
    this.service.jobs.unshift(job);
    this.service.emit("change");
    const run = async () => {
      if (job.status === "cancelled") return;
      job.status = "running";
      this.service.emit("change");
      for (const photo of photos) {
        if ((job.status as string) === "cancelled") break;
        let temp: string | undefined;
        try {
          const data = await this.render(photo.path, photo.recipe, {
            format: opts.format,
            quality: opts.quality,
            maxDimension: opts.maxDimension,
          });
          if ((job.status as string) === "cancelled") break;
          temp = path.join(directory, `.lumaflux-${randomUUID()}.tmp`);
          await writeFile(temp, data, { flag: "wx" });
          const base = path.parse(photo.name).name + opts.suffix;
          const ext = opts.format === "jpeg" ? "jpg" : opts.format;
          let saved = false;
          for (let n = 0; n < 10000; n++) {
            const dest = path.join(
              directory,
              `${base}${n ? `-${n}` : ""}.${ext}`,
            );
            try {
              await link(temp, dest);
              job.outputs.push(dest);
              saved = true;
              break;
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
            }
          }
          if (!saved) throw new Error("Too many filename collisions");
        } catch (e) {
          job.errors.push({ id: photo.id, message: (e as Error).message });
        } finally {
          if (temp) await unlink(temp).catch(() => {});
        }
        job.done++;
        this.service.emit("change");
      }
      if ((job.status as string) !== "cancelled")
        job.status = job.errors.length === job.total ? "failed" : "completed";
      this.service.emit("change");
    };
    this.tail = this.tail.then(run, run);
    return structuredClone(job);
  }
  get(id: string) {
    const job = this.service.jobs.find((j) => j.id === id);
    if (!job) throw new Error("NOT_FOUND: Export job");
    return structuredClone(job);
  }
  cancel(id: string) {
    const job = this.service.jobs.find((j) => j.id === id);
    if (!job) throw new Error("NOT_FOUND: Export job");
    if (job.status === "queued" || job.status === "running") {
      job.status = "cancelled";
      this.service.emit("change");
    }
    return structuredClone(job);
  }
  async idle() {
    await this.tail;
  }
}
