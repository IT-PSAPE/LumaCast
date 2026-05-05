/// <reference lib="webworker" />

// Off-main-thread NDI frame readback. The renderer hands us an ImageBitmap
// snapshotted from the off-screen Konva stage; we draw it into our own
// OffscreenCanvas, read the pixel buffer back, and ship the buffer (transferable)
// back to the main thread for IPC. This keeps the 8 MB GPU→CPU readback off
// the renderer's main thread.

const NDI_OUTPUT_WIDTH = 1920;
const NDI_OUTPUT_HEIGHT = 1080;

const canvas = new OffscreenCanvas(NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT);
const ctx = canvas.getContext('2d', { willReadFrequently: true });

interface CaptureRequest {
  type: 'capture';
  bitmap: ImageBitmap;
  requestId: number;
  withAlpha: boolean;
}

interface CaptureResponse {
  type: 'captured';
  requestId: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  readbackDurationMs: number;
}

interface CaptureError {
  type: 'capture-failed';
  requestId: number;
  error: string;
}

type WorkerOutbound = CaptureResponse | CaptureError;

self.onmessage = (event: MessageEvent<CaptureRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'capture') return;

  if (!ctx) {
    const failure: CaptureError = {
      type: 'capture-failed',
      requestId: msg.requestId,
      error: 'OffscreenCanvas 2D context unavailable',
    };
    msg.bitmap.close();
    (self as unknown as { postMessage: (m: WorkerOutbound) => void }).postMessage(failure);
    return;
  }

  try {
    const readbackStartedAt = performance.now();
    if (msg.withAlpha) {
      ctx.clearRect(0, 0, NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT);
    } else {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT);
    }
    ctx.drawImage(
      msg.bitmap,
      0,
      0,
      msg.bitmap.width,
      msg.bitmap.height,
      0,
      0,
      NDI_OUTPUT_WIDTH,
      NDI_OUTPUT_HEIGHT,
    );
    msg.bitmap.close();
    const imageData = ctx.getImageData(0, 0, NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT);
    const buffer = imageData.data.buffer as ArrayBuffer;
    const readbackDurationMs = performance.now() - readbackStartedAt;

    const response: CaptureResponse = {
      type: 'captured',
      requestId: msg.requestId,
      buffer,
      width: NDI_OUTPUT_WIDTH,
      height: NDI_OUTPUT_HEIGHT,
      readbackDurationMs,
    };
    (self as unknown as {
      postMessage: (m: WorkerOutbound, transfer: Transferable[]) => void;
    }).postMessage(response, [buffer]);
  } catch (error) {
    const failure: CaptureError = {
      type: 'capture-failed',
      requestId: msg.requestId,
      error: error instanceof Error ? error.message : String(error),
    };
    try {
      msg.bitmap.close();
    } catch {
      // ignore
    }
    (self as unknown as { postMessage: (m: WorkerOutbound) => void }).postMessage(failure);
  }
};

export type { CaptureRequest, CaptureResponse, CaptureError, WorkerOutbound };
