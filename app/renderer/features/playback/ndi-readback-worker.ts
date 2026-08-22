/// <reference lib="webworker" />

import {
  NDI_OUTPUT_HEIGHT,
  NDI_OUTPUT_WIDTH,
  type NdiFrameRelease,
  type NdiFrameTelemetry,
  type NdiOutputName,
} from '@lumacast/protocol';
import { NdiFrameTransportClient, type NdiFrameTransportPort } from './ndi-frame-transport-client';

const canvas = new OffscreenCanvas(NDI_OUTPUT_WIDTH, NDI_OUTPUT_HEIGHT);
const ctx = canvas.getContext('2d', { willReadFrequently: true });

interface CaptureRequest {
  type: 'capture';
  bitmap: ImageBitmap;
  requestId: number;
  withAlpha: boolean;
}

interface AttachTransportRequest {
  type: 'attach-transport';
  name: NdiOutputName;
  port: MessagePort;
}

interface ResetTransportRequest {
  type: 'reset-transport';
}

interface SubmitFrameRequest {
  type: 'submit-frame';
  requestId: number;
  name: NdiOutputName;
  attemptId: string;
  telemetry: NdiFrameTelemetry;
}

type WorkerInbound = CaptureRequest | AttachTransportRequest | ResetTransportRequest | SubmitFrameRequest;

interface ReadbackCompleteResponse {
  type: 'readback-complete';
  requestId: number;
  width: number;
  height: number;
  readbackDurationMs: number;
}

interface CaptureResponse {
  type: 'captured';
  requestId: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  telemetry: NdiFrameTelemetry;
}

interface CaptureError {
  type: 'capture-failed';
  requestId: number;
  error: string;
}

interface ReleasedResponse {
  type: 'released';
  release: NdiFrameRelease;
}

interface TransportFallbackResponse {
  type: 'transport-fallback';
  name: NdiOutputName;
}

interface TransportReadyResponse {
  type: 'transport-ready';
  name: NdiOutputName;
}

type WorkerOutbound =
  | ReadbackCompleteResponse
  | CaptureResponse
  | CaptureError
  | ReleasedResponse
  | TransportReadyResponse
  | TransportFallbackResponse;

interface PendingReadback {
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

const pendingReadbacks = new Map<number, PendingReadback>();

function post(message: WorkerOutbound, transfer?: Transferable[]): void {
  if (transfer) {
    (self as unknown as { postMessage: (value: WorkerOutbound, transfer: Transferable[]) => void })
      .postMessage(message, transfer);
    return;
  }
  (self as unknown as { postMessage: (value: WorkerOutbound) => void }).postMessage(message);
}

const transport = new NdiFrameTransportClient({
  onReleased: (release) => post({ type: 'released', release }),
  onFallback: (name) => post({ type: 'transport-fallback', name }),
  onReady: (name) => post({ type: 'transport-ready', name }),
});

function failCapture(requestId: number, error: unknown): void {
  pendingReadbacks.delete(requestId);
  post({
    type: 'capture-failed',
    requestId,
    error: error instanceof Error ? error.message : String(error),
  });
}

function capture(msg: CaptureRequest): void {
  // Only one frame may be in flight. Drop any stale readback retained after
  // the renderer watchdog abandoned its request before submitting telemetry.
  pendingReadbacks.clear();
  if (!ctx) {
    msg.bitmap.close();
    failCapture(msg.requestId, 'OffscreenCanvas 2D context unavailable');
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
    pendingReadbacks.set(msg.requestId, {
      buffer,
      width: NDI_OUTPUT_WIDTH,
      height: NDI_OUTPUT_HEIGHT,
    });
    post({
      type: 'readback-complete',
      requestId: msg.requestId,
      width: NDI_OUTPUT_WIDTH,
      height: NDI_OUTPUT_HEIGHT,
      readbackDurationMs: performance.now() - readbackStartedAt,
    });
  } catch (error) {
    try {
      msg.bitmap.close();
    } catch {
      // ignore
    }
    failCapture(msg.requestId, error);
  }
}

function submitFrame(msg: SubmitFrameRequest): void {
  const pending = pendingReadbacks.get(msg.requestId);
  if (!pending) {
    failCapture(msg.requestId, 'NDI readback buffer is no longer available');
    return;
  }
  pendingReadbacks.delete(msg.requestId);
  const sentDirectly = transport.sendFrame({
    type: 'frame',
    name: msg.name,
    attemptId: msg.attemptId,
    buffer: pending.buffer,
    width: pending.width,
    height: pending.height,
    telemetry: msg.telemetry,
  });
  if (sentDirectly) return;

  const response: CaptureResponse = {
    type: 'captured',
    requestId: msg.requestId,
    buffer: pending.buffer,
    width: pending.width,
    height: pending.height,
    telemetry: msg.telemetry,
  };
  post(response, [pending.buffer]);
}

self.onmessage = (event: MessageEvent<WorkerInbound>) => {
  const msg = event.data;
  if (!msg) return;
  if (msg.type === 'capture') {
    capture(msg);
  } else if (msg.type === 'submit-frame') {
    submitFrame(msg);
  } else if (msg.type === 'attach-transport') {
    transport.attach(msg.name, msg.port as unknown as NdiFrameTransportPort);
  } else if (msg.type === 'reset-transport') {
    transport.reset();
  }
};

export type {
  AttachTransportRequest,
  CaptureError,
  CaptureRequest,
  CaptureResponse,
  ReadbackCompleteResponse,
  ReleasedResponse,
  ResetTransportRequest,
  SubmitFrameRequest,
  TransportFallbackResponse,
  TransportReadyResponse,
  WorkerInbound,
  WorkerOutbound,
};
