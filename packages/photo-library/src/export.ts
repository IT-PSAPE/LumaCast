import { randomUUID } from "node:crypto";
import { realpath, stat, writeFile, link, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { PhotoService } from "./service.js";
import type { ExportOptions, ExportJob, Photo } from "@lumacast/photo-model";
import { MAX_PHOTO_BATCH_SIZE } from "@lumacast/photo-model";
// The render contract is imaging's; the library only consumes it, so it is
// re-exported here rather than declared a second time.
import type { Renderer } from "@lumacast/photo-imaging";
export type { Renderer } from "@lumacast/photo-imaging";
export const exportSchema = z
  .object({
    ids: z.array(z.string()).min(1).max(MAX_PHOTO_BATCH_SIZE),
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
// Admission bounds include the current job until rendering and cleanup settle.
export const MAX_PENDING_EXPORT_PHOTOS = MAX_PHOTO_BATCH_SIZE;
export const MAX_PENDING_EXPORT_JOBS = 100;
export const MAX_EXPORT_HISTORY_JOBS = 100;
export const MAX_EXPORT_HISTORY_PHOTOS = MAX_PHOTO_BATCH_SIZE;

type QueuedExport = {
  job: ExportJob;
  photos: Photo[];
  options: z.infer<typeof exportSchema>;
  directory: string;
};

export class ExportManager {
  private queue: QueuedExport[] = [];
  private current?: QueuedExport;
  private pendingPhotos = 0;
  private draining?: Promise<void>;
  constructor(
    private service: PhotoService,
    private render: Renderer,
  ) {}
  async start(input: ExportOptions) {
    const opts = exportSchema.parse(input);
    const directory = await realpath(opts.directory);
    if (!(await stat(directory)).isDirectory())
      throw new Error("INVALID_DIRECTORY: Choose a folder");
    const ids = [...new Set(opts.ids)];
    if (
      this.queue.length + (this.current ? 1 : 0) >= MAX_PENDING_EXPORT_JOBS ||
      this.pendingPhotos + ids.length > MAX_PENDING_EXPORT_PHOTOS
    )
      throw new Error(
        "QUEUE_FULL: Export queue is full. Wait for exports to finish or cancel a queued batch, then try again.",
      );
    // No await separates the capacity check, snapshot capture and admission.
    const photos = this.service.photosByIds(ids);
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
    this.queue.push({ job, photos, options: opts, directory });
    this.pendingPhotos += photos.length;
    const result = structuredClone(job);
    this.service.emit("change", { kind: "jobs" });
    this.draining ??= Promise.resolve().then(() => this.drain());
    return result;
  }
  private async drain() {
    try {
      while ((this.current = this.queue.shift())) {
        const entry = this.current;
        try {
          await this.run(entry);
        } finally {
          this.pendingPhotos -= entry.photos.length;
          this.current = undefined;
          this.pruneHistory();
          this.service.emit("change", { kind: "jobs" });
        }
      }
    } finally {
      this.draining = undefined;
    }
  }
  private async run({ job, photos, options: opts, directory }: QueuedExport) {
    job.status = "running";
    this.service.emit("change", { kind: "jobs" });
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
        if ((job.status as string) === "cancelled") break;
        const base = path.parse(photo.name).name + opts.suffix;
        const ext = opts.format === "jpeg" ? "jpg" : opts.format;
        let saved = false;
        for (let n = 0; n < 10000; n++) {
          if ((job.status as string) === "cancelled") break;
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
        if ((job.status as string) === "cancelled") break;
        if (!saved) throw new Error("Too many filename collisions");
      } catch (e) {
        job.errors.push({ id: photo.id, message: (e as Error).message });
      } finally {
        if (temp) await unlink(temp).catch(() => {});
      }
      job.done++;
      this.service.emit("change", { kind: "jobs" });
    }
    if ((job.status as string) !== "cancelled")
      job.status = job.errors.length === job.total ? "failed" : "completed";
  }
  private pruneHistory() {
    let jobs = 0;
    let photos = 0;
    let full = false;
    const retained = this.service.jobs.filter((job) => {
      if (
        job === this.current?.job ||
        job.status === "queued" ||
        job.status === "running"
      )
        return true;
      // Keep the newest submitted terminal jobs as a contiguous history prefix.
      if (
        full ||
        jobs >= MAX_EXPORT_HISTORY_JOBS ||
        photos + job.total > MAX_EXPORT_HISTORY_PHOTOS
      ) {
        full = true;
        return false;
      }
      jobs++;
      photos += job.total;
      return true;
    });
    this.service.jobs.splice(0, this.service.jobs.length, ...retained);
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
      const queued = this.queue.findIndex((entry) => entry.job === job);
      if (queued !== -1) {
        const [entry] = this.queue.splice(queued, 1);
        this.pendingPhotos -= entry!.photos.length;
      }
      this.pruneHistory();
      this.service.emit("change", { kind: "jobs" });
    }
    return structuredClone(job);
  }
  cancelAll() {
    // Cancellation may evict terminal history, so iterate a detached job list.
    for (const job of [...this.service.jobs])
      if (job.status === "queued" || job.status === "running") this.cancel(job.id);
  }
  async idle() {
    await this.draining;
  }
}
