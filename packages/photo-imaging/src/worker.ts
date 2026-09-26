import { parentPort } from "node:worker_threads";
import { renderImage } from "./render.js";

if (!parentPort) throw new Error("worker.ts must be run as a worker thread");

parentPort.on(
  "message",
  async (msg: { id: string; filePath: string; recipe: any; options: any }) => {
    try {
      const buf = await renderImage(msg.filePath, msg.recipe, msg.options);
      parentPort!.postMessage({ id: msg.id, buf });
    } catch (err) {
      parentPort!.postMessage({ id: msg.id, error: (err as Error).message });
    }
  },
);

parentPort.postMessage({ type: "ready" });
