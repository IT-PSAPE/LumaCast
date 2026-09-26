import { Worker } from "node:worker_threads";
import { stat } from "node:fs/promises";
import { ByteCache } from "./cache.js";

export type DecodedRaw = {
  data: Buffer;
  width: number;
  height: number;
  metadata: Record<string, string>;
};
const cache = new ByteCache<DecodedRaw>(128 * 1024 * 1024);
const pending = new Map<string, Promise<DecodedRaw>>();
let rawDecoderEntry: URL | string | undefined;
/**
 * Points RAW decoding at an app-supplied decoder worker. The default is the
 * package's own `raw-decoder.mjs`, which is a self-contained Node worker and
 * never imports app code. An app that bundles its own RAW worker (and a main
 * process decoding outside a render worker) sets it once at startup.
 */
export function configureRawDecoder(workerEntry: URL | string) {
  rawDecoderEntry = workerEntry;
}
function rawDecoder(): URL | string {
  return rawDecoderEntry ?? new URL("./raw-decoder.mjs", import.meta.url);
}
export async function decodeRaw(file: string): Promise<DecodedRaw> {
  const s = await stat(file);
  const key = `${file}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const existing = pending.get(key);
  if (existing) return existing;
  const work = new Promise<DecodedRaw>((resolve, reject) => {
    const worker = new Worker(rawDecoder(), {
      workerData: file,
      execArgv: [],
    });
    const timer = setTimeout(() => {
      reject(new Error("RAW decoding timed out after 120 seconds"));
      void worker.terminate();
    }, 120_000);
    worker.once("message", (result: DecodedRaw & { error?: string }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (result.error) reject(new Error(result.error));
      else resolve({ ...result, data: Buffer.from(result.data) });
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("RAW decoder exited before returning an image"));
    });
  });
  pending.set(key, work);
  try {
    const decoded = await work;
    cache.set(key, decoded, decoded.data.byteLength);
    return decoded;
  } finally {
    pending.delete(key);
  }
}
