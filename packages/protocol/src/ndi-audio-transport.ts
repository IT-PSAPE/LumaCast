import type { NdiOutputName } from './ndi-observability';

export const NDI_AUDIO_TRANSPORT_VERSION = 1;
export const NDI_AUDIO_TRANSPORT_WINDOW_MESSAGE = 'lumacast:ndi-audio-transport-port';
export const NDI_AUDIO_TRANSPORT_HANDSHAKE_TIMEOUT_MS = 500;

// These caps are kept in line with the engine's audio submission contract
// (`MAX_AUDIO_CHANNELS`, `MAX_AUDIO_SAMPLES_PER_CHANNEL`,
// `MAX_AUDIO_SAMPLE_RATE` in @lumacast/engine). The host re-validates frames
// against them at the trust boundary; the byte length below is derived the
// same way so stereo 48 kHz planar buffers can never be substituted by a
// differently sized payload.
export const NDI_AUDIO_TRANSPORT_MAX_CHANNELS = 32;
export const NDI_AUDIO_TRANSPORT_MAX_SAMPLE_RATE = 192000;
export const NDI_AUDIO_TRANSPORT_MAX_SAMPLES_PER_CHANNEL = 192000;

const BYTES_PER_SAMPLE = 4;
const MAX_AUDIO_FRAME_BYTES =
  NDI_AUDIO_TRANSPORT_MAX_CHANNELS * NDI_AUDIO_TRANSPORT_MAX_SAMPLES_PER_CHANNEL * BYTES_PER_SAMPLE;

export interface NdiAudioTransportHandshake {
  type: 'handshake';
  version: number;
  name: NdiOutputName;
}

export interface NdiAudioTransportFrame {
  type: 'audio';
  name: NdiOutputName;
  buffer: ArrayBuffer;
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
}

export interface NdiAudioTransportClose {
  type: 'close';
  name: NdiOutputName;
}

export type NdiAudioTransportWorkerMessage =
  | NdiAudioTransportHandshake
  | NdiAudioTransportFrame
  | NdiAudioTransportClose;

export interface NdiAudioTransportReady {
  type: 'ready';
  version: number;
  name: NdiOutputName;
}

export type NdiAudioTransportFallbackReason =
  | 'hostUnavailable'
  | 'invalidHandshake'
  | 'invalidPayload';

export interface NdiAudioTransportFallback {
  type: 'fallback';
  name: NdiOutputName;
  reason: NdiAudioTransportFallbackReason;
}

export type NdiAudioTransportHostMessage =
  | NdiAudioTransportReady
  | NdiAudioTransportFallback;

export interface NdiAudioTransportPortAnnouncement {
  type: typeof NDI_AUDIO_TRANSPORT_WINDOW_MESSAGE;
  version: number;
  name: NdiOutputName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOutputName(value: unknown): value is NdiOutputName {
  return value === 'audience' || value === 'stage';
}

export function isNdiAudioTransportHandshake(
  value: unknown,
  expectedName: NdiOutputName,
): value is NdiAudioTransportHandshake {
  if (!isRecord(value)) return false;
  return value.type === 'handshake'
    && value.version === NDI_AUDIO_TRANSPORT_VERSION
    && value.name === expectedName;
}

export function isNdiAudioTransportPortAnnouncement(
  value: unknown,
): value is NdiAudioTransportPortAnnouncement {
  if (!isRecord(value)) return false;
  return value.type === NDI_AUDIO_TRANSPORT_WINDOW_MESSAGE
    && value.version === NDI_AUDIO_TRANSPORT_VERSION
    && isOutputName(value.name);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isNdiAudioTransportSampleRate(value: unknown): value is number {
  return isPositiveInteger(value) && value <= NDI_AUDIO_TRANSPORT_MAX_SAMPLE_RATE;
}

export function isNdiAudioTransportChannelCount(value: unknown): value is number {
  return isPositiveInteger(value) && value <= NDI_AUDIO_TRANSPORT_MAX_CHANNELS;
}

export function isNdiAudioTransportSamplesPerChannel(value: unknown): value is number {
  return isPositiveInteger(value) && value <= NDI_AUDIO_TRANSPORT_MAX_SAMPLES_PER_CHANNEL;
}

/**
 * Validates the renderer audio frame again inside the utility process. The
 * layout is planar float32: one contiguous channel block per channel, each
 * `samplesPerChannel * 4` bytes long, so the buffer must match exactly —
 * a mismatched size is rejected rather than sliced.
 */
export function decodeNdiAudioTransportFrame(
  value: unknown,
  expectedName: NdiOutputName,
): NdiAudioTransportFrame | null {
  if (!isRecord(value) || value.type !== 'audio') return null;
  if (value.name !== expectedName) return null;
  if (!isNdiAudioTransportSampleRate(value.sampleRate)) return null;
  if (!isNdiAudioTransportChannelCount(value.channels)) return null;
  if (!isNdiAudioTransportSamplesPerChannel(value.samplesPerChannel)) return null;
  if (!(value.buffer instanceof ArrayBuffer)) return null;
  const expectedBytes = value.channels * value.samplesPerChannel * BYTES_PER_SAMPLE;
  if (value.buffer.byteLength !== expectedBytes) return null;
  if (expectedBytes > MAX_AUDIO_FRAME_BYTES) return null;

  return {
    type: 'audio',
    name: expectedName,
    buffer: value.buffer,
    sampleRate: value.sampleRate,
    channels: value.channels,
    samplesPerChannel: value.samplesPerChannel,
  };
}