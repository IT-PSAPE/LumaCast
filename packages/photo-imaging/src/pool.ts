import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Recipe, RenderOptions } from "@lumacast/photo-model";
type Job = {
  filePath: string;
  recipe: Recipe;
  options: RenderOptions;
  resolve: (b: Buffer) => void;
  reject: (e: Error) => void;
};
type Slot = { worker: Worker; job?: Job; failed: boolean };
const SOURCE_WORKER_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);
// The compiled worker and its TypeScript source, beside the module that loads it.
const COMPILED_WORKER = "./worker.js";
const SOURCE_WORKER = "./worker.ts";
const SOURCE_LOADER_EXEC_ARGV = ["--require", "tsx/cjs"];
const MISSING_WORKER_MESSAGE =
  `Image worker not found: neither ${COMPILED_WORKER} nor ${SOURCE_WORKER} exists next to this module ` +
  `(looked in ${new URL(".", import.meta.url).pathname}). This happens when the imaging package is ` +
  "bundled without its worker. Pass the built worker entry explicitly, e.g. " +
  "`new RenderPool(2, renderWorkerEntry)`, where renderWorkerEntry comes from " +
  "resolveImagingResources(__dirname).renderWorkerEntry.";
// A TypeScript entry has to be loaded through tsx, whether the package fell back
// to its own source or an app passed a .ts worker explicitly. An emitted .js
// entry runs as-is. The loader is the CommonJS require hook on purpose: the ESM
// `--import tsx` hooks are not applied inside a worker thread on Node 22.13
// (the engines minimum and the CI pin), so the worker failed with "Unknown file
// extension .ts" there while Node 24 masked it with native type stripping.
// `--require tsx/cjs` installs synchronously in the worker on every supported
// Node version.
function isSourceEntry(entry: URL | string): boolean {
  const raw = typeof entry === "string" ? entry : entry.pathname;
  return SOURCE_WORKER_EXTENSIONS.has(
    path.extname(raw.split("?")[0]!.split("#")[0]!),
  );
}
export class RenderPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private closed = false;
  private readonly workerEntry: URL | string;
  private readonly needsSourceLoader: boolean;
  constructor(concurrency = 2, workerEntry?: URL | string) {
    // Resolved up front so a misconfigured build fails at construction with an
    // actionable message instead of at the first render, one opaque worker
    // exit at a time.
    this.workerEntry = workerEntry ?? RenderPool.bundledWorkerEntry();
    this.needsSourceLoader = isSourceEntry(this.workerEntry);
    for (let i = 0; i < Math.max(1, Math.min(2, concurrency)); i++)
      this.spawn();
  }
  // Without an explicit entry the package's own worker is used: its compiled
  // form when present, otherwise its TypeScript source through tsx. An app that
  // bundles its own worker passes that entry explicitly instead.
  private static bundledWorkerEntry(): URL {
    const compiled = new URL(COMPILED_WORKER, import.meta.url);
    if (existsSync(compiled)) return compiled;
    const source = new URL(SOURCE_WORKER, import.meta.url);
    if (existsSync(source)) return source;
    throw new Error(MISSING_WORKER_MESSAGE);
  }
  private spawn() {
    const worker = new Worker(this.workerEntry, {
      execArgv: this.needsSourceLoader ? SOURCE_LOADER_EXEC_ARGV : [],
    });
    const slot: Slot = { worker, failed: false };
    this.slots.push(slot);
    worker.on(
      "message",
      (msg: { buf?: Uint8Array; error?: string; type?: string }) => {
        if (msg.type === "ready") return;
        const job = slot.job;
        slot.job = undefined;
        if (job) {
          if (msg.error) job.reject(new Error(msg.error));
          else if (msg.buf) job.resolve(Buffer.from(msg.buf));
          else job.reject(new Error("Worker returned no image"));
        }
        this.drain();
      },
    );
    const fail = (error: Error) => {
      if (slot.failed) return;
      slot.failed = true;
      slot.job?.reject(error);
      slot.job = undefined;
      this.slots = this.slots.filter((s) => s !== slot);
      if (!this.closed) {
        for (const job of this.queue) job.reject(error);
        this.queue = [];
      }
    };
    worker.on("error", fail);
    worker.on("exit", (code) => {
      if (!this.closed) fail(new Error(`Image worker stopped (${code})`));
    });
  }
  private drain() {
    for (const slot of this.slots) {
      if (!slot.job && this.queue.length) {
        slot.job = this.queue.shift()!;
        try {
          slot.worker.postMessage({
            id: "render",
            filePath: slot.job.filePath,
            recipe: slot.job.recipe,
            options: slot.job.options,
          });
        } catch (e) {
          slot.job.reject(e as Error);
          slot.job = undefined;
        }
      }
    }
  }
  render(
    filePath: string,
    recipe: Recipe,
    options: RenderOptions = {},
  ): Promise<Buffer> {
    if (this.closed)
      return Promise.reject(new Error("Image workers are closed"));
    if (!this.slots.length)
      return Promise.reject(
        new Error("Image workers stopped. Restart Lumaflux."),
      );
    if (this.queue.length >= 256)
      return Promise.reject(
        new Error("Render queue is full; try again shortly"),
      );
    return new Promise((resolve, reject) => {
      const job = { filePath, recipe, options, resolve, reject };
      // Canvas updates must not wait behind a gallery's queued thumbnails or exports.
      const interactive =
        options.preview !== undefined && (options.maxDimension ?? 1600) > 360;
      if (interactive) {
        const index = this.queue.findIndex(
          (j) =>
            !(
              j.options.preview !== undefined &&
              (j.options.maxDimension ?? 1600) > 360
            ),
        );
        if (index < 0) this.queue.push(job);
        else this.queue.splice(index, 0, job);
      } else this.queue.push(job);
      this.drain();
    });
  }
  async close() {
    this.closed = true;
    const error = new Error("Image workers closed");
    for (const job of this.queue) job.reject(error);
    this.queue = [];
    for (const slot of this.slots) slot.job?.reject(error);
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
  }
}
