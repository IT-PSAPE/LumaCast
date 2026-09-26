// A disposable Node worker keeps synchronous WASM processing off the app thread
// and releases the decoder's large WASM heap on both success and failure.
import { parentPort, workerData } from "node:worker_threads";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import createModule from "libraw-wasm/dist/libraw.js";

const require = createRequire(import.meta.url);
try {
  if ((await stat(workerData)).size > 512 * 1024 * 1024)
    throw new Error("RAW file exceeds the 512 MB input limit");
  const module = await createModule({
    wasmBinary: await readFile(require.resolve("libraw-wasm/dist/libraw.wasm")),
  });
  const decoder = new module.LibRaw();
  try {
    decoder.open(new Uint8Array(await readFile(workerData)), {
      useCameraWb: true,
      outputColor: 1,
      outputBps: 8,
      noAutoBright: true,
      userFlip: -1,
      gamm: [1 / 2.4, 12.92],
    });
    const meta = decoder.metadata(true);
    const validSize = (w, h) =>
      Number.isInteger(w) &&
      Number.isInteger(h) &&
      w > 0 &&
      h > 0 &&
      w * h <= 80_000_000;
    if (!validSize(meta.raw_width, meta.raw_height))
      throw new Error(
        "RAW image exceeds 80 million pixel limit or has invalid dimensions",
      );
    const output = decoder.imageData();
    if (
      !output ||
      !validSize(output.width, output.height) ||
      output.bits !== 8 ||
      output.colors !== 3 ||
      output.data.length !== output.width * output.height * 3
    )
      throw new Error("RAW decoder returned invalid image data");
    const metadata = {
      "Color space": "sRGB",
      "Processing depth": "8-bit",
      Decoder: "LibRaw",
    };
    if (meta.camera_make || meta.camera_model)
      metadata.Camera = [meta.camera_make, meta.camera_model]
        .filter(Boolean)
        .join(" ");
    if (meta.lens?.Lens) metadata.Lens = meta.lens.Lens;
    if (meta.iso_speed > 0) metadata.ISO = String(meta.iso_speed);
    if (meta.aperture > 0) metadata.Aperture = `f/${meta.aperture}`;
    if (meta.shutter > 0)
      metadata.Shutter =
        meta.shutter < 1
          ? `1/${Math.round(1 / meta.shutter)} s`
          : `${meta.shutter} s`;
    if (meta.focal_len > 0) metadata["Focal length"] = `${meta.focal_len} mm`;
    if (meta.color_data?.raw_bps > 0)
      metadata["Sensor bit depth"] = String(meta.color_data.raw_bps);
    if (meta.timestamp > 0)
      metadata.Captured = new Date(meta.timestamp * 1000).toISOString();
    parentPort.postMessage(
      {
        data: output.data,
        width: output.width,
        height: output.height,
        metadata,
      },
      [output.data.buffer],
    );
  } finally {
    decoder.delete();
  }
} catch (error) {
  parentPort.postMessage({
    error: `Cannot decode RAW file: ${error.message || String(error)}. The file may be damaged or its camera/compression unsupported.`,
  });
}
