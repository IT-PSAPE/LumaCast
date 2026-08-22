import { NDI_OUTPUT_HEIGHT, NDI_OUTPUT_WIDTH } from './ndi';
import type { NdiFrameRelease, NdiFrameTelemetry, NdiOutputName } from './ndi-observability';
import { sanitizeNdiFrameTelemetry } from './codecs';

export const NDI_FRAME_TRANSPORT_VERSION = 1;
export const NDI_FRAME_TRANSPORT_WINDOW_MESSAGE = 'lumacast:ndi-frame-transport-port';
export const NDI_FRAME_TRANSPORT_HANDSHAKE_TIMEOUT_MS = 500;

const BYTES_PER_PIXEL = 4;
const FRAME_BYTES = NDI_OUTPUT_WIDTH * NDI_OUTPUT_HEIGHT * BYTES_PER_PIXEL;
const MAX_ATTEMPT_ID_LENGTH = 128;
const ATTEMPT_ID_PATTERN = /^[A-Za-z0-9:_-]+$/;

export interface NdiFrameTransportHandshake {
  type: 'handshake';
  version: number;
  name: NdiOutputName;
}

export interface NdiFrameTransportFrame {
  type: 'frame';
  name: NdiOutputName;
  attemptId: string;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  telemetry?: NdiFrameTelemetry;
}

export interface NdiFrameTransportClose {
  type: 'close';
  name: NdiOutputName;
}

export type NdiFrameTransportWorkerMessage =
  | NdiFrameTransportHandshake
  | NdiFrameTransportFrame
  | NdiFrameTransportClose;

export interface NdiFrameTransportReady {
  type: 'ready';
  version: number;
  name: NdiOutputName;
}

export interface NdiFrameTransportReleased {
  type: 'released';
  release: NdiFrameRelease;
}

export type NdiFrameTransportFallbackReason =
  | 'hostUnavailable'
  | 'invalidHandshake';

export interface NdiFrameTransportFallback {
  type: 'fallback';
  name: NdiOutputName;
  reason: NdiFrameTransportFallbackReason;
}

export type NdiFrameTransportHostMessage =
  | NdiFrameTransportReady
  | NdiFrameTransportReleased
  | NdiFrameTransportFallback;

export interface NdiFrameTransportPortAnnouncement {
  type: typeof NDI_FRAME_TRANSPORT_WINDOW_MESSAGE;
  version: number;
  name: NdiOutputName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOutputName(value: unknown): value is NdiOutputName {
  return value === 'audience' || value === 'stage';
}

export function isNdiFrameTransportAttemptId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ATTEMPT_ID_LENGTH
    && ATTEMPT_ID_PATTERN.test(value);
}

export function isNdiFrameTransportHandshake(
  value: unknown,
  expectedName: NdiOutputName,
): value is NdiFrameTransportHandshake {
  if (!isRecord(value)) return false;
  return value.type === 'handshake'
    && value.version === NDI_FRAME_TRANSPORT_VERSION
    && value.name === expectedName;
}

export function isNdiFrameTransportPortAnnouncement(
  value: unknown,
): value is NdiFrameTransportPortAnnouncement {
  if (!isRecord(value)) return false;
  return value.type === NDI_FRAME_TRANSPORT_WINDOW_MESSAGE
    && value.version === NDI_FRAME_TRANSPORT_VERSION
    && isOutputName(value.name);
}

/**
 * Validates the renderer-worker frame again inside the utility process.
 * The top-level attempt id is canonical so release routing cannot be changed
 * by advisory telemetry.
 */
export function decodeNdiFrameTransportFrame(
  value: unknown,
  expectedName: NdiOutputName,
): NdiFrameTransportFrame | null {
  if (!isRecord(value) || value.type !== 'frame') return null;
  if (value.name !== expectedName || !isNdiFrameTransportAttemptId(value.attemptId)) return null;
  if (value.width !== NDI_OUTPUT_WIDTH || value.height !== NDI_OUTPUT_HEIGHT) return null;
  if (!(value.buffer instanceof ArrayBuffer) || value.buffer.byteLength !== FRAME_BYTES) return null;

  const telemetry = sanitizeNdiFrameTelemetry(value.telemetry);
  if (telemetry) {
    telemetry.attemptId = value.attemptId;
    // This route bypasses main and the proxy. Those timestamps are owned by
    // process boundaries the worker cannot observe and must not be spoofable.
    delete telemetry.mainReceivedAtMs;
    delete telemetry.proxyForwardedAtMs;
    delete telemetry.hostReceivedAtMs;
  }
  return {
    type: 'frame',
    name: expectedName,
    attemptId: value.attemptId,
    buffer: value.buffer,
    width: NDI_OUTPUT_WIDTH,
    height: NDI_OUTPUT_HEIGHT,
    ...(telemetry ? { telemetry } : {}),
  };
}
