// Pure, mediabunny-free export planning helpers: frame-count/timing math,
// container/codec selection, audio bitrate estimates, and ETA. Everything
// that needs mediabunny (Output, Input, sinks/sources, codec probing) stays
// in export-engine.ts; this module is what that engine's decisions are
// tested against.
import { findContainer } from '../../../shared/export-presets';
import type { ExportAudioCodec, ExportContainer, ExportQuality, ExportVideoCodec } from '../../../shared/export-presets';

export interface FramePlan {
  count: number;
  frameDurationS: number;
}

/** Frame count/timing for a clip of `durationMs` at `fps`. Always at least one frame. */
export function planFrames(durationMs: number, fps: number): FramePlan {
  const safeFps = fps > 0 ? fps : 1;
  const safeDurationMs = Math.max(0, durationMs);
  const count = Math.max(1, Math.ceil((safeDurationMs / 1000) * safeFps));
  return { count, frameDurationS: 1 / safeFps };
}

export function videoCodecsForContainer(container: ExportContainer): readonly ExportVideoCodec[] {
  return findContainer(container)?.videoCodecs ?? [];
}

export function audioCodecsForContainer(container: ExportContainer): readonly ExportAudioCodec[] {
  return findContainer(container)?.audioCodecs ?? [];
}

/**
 * Picks the video codec to encode with: `requested` when the container
 * allows it and the browser can encode it; else the container's first
 * codec (in `EXPORT_CONTAINERS` order) the browser can encode; else null.
 * `encodable` is the pre-resolved list of codecs the browser can actually
 * encode — probing that is export-engine.ts's job (`canEncodeVideo`).
 */
export function pickVideoCodec(
  container: ExportContainer,
  requested: ExportVideoCodec,
  encodable: readonly string[],
): ExportVideoCodec | null {
  const allowed = videoCodecsForContainer(container);
  const encodableSet = new Set(encodable);
  const fits = (codec: ExportVideoCodec) => allowed.includes(codec) && encodableSet.has(codec);
  if (fits(requested)) return requested;
  return allowed.find(fits) ?? null;
}

/** Picks the audio codec to encode with: `requested`, else its aac<->opus counterpart, else null. */
export function pickAudioCodec(
  container: ExportContainer,
  requested: ExportAudioCodec,
  encodable: readonly string[],
): ExportAudioCodec | null {
  const allowed = audioCodecsForContainer(container);
  const encodableSet = new Set(encodable);
  const fits = (codec: ExportAudioCodec) => allowed.includes(codec) && encodableSet.has(codec);
  if (fits(requested)) return requested;
  const fallback: ExportAudioCodec = requested === 'aac' ? 'opus' : 'aac';
  return fits(fallback) ? fallback : null;
}

const AUDIO_BITRATE_BY_QUALITY: Record<ExportQuality, number> = {
  low: 96_000,
  medium: 128_000,
  high: 192_000,
  'very-high': 256_000,
};

/** Estimated audio bitrate in bits/s for a given quality. (Video's own bitrate estimate lives in shared/export-presets.ts's `estimateBitrate`.) */
export function estimateAudioBitrate(quality: ExportQuality): number {
  return AUDIO_BITRATE_BY_QUALITY[quality];
}

export interface FrameTimingSample {
  /** Frames completed so far, as of `atMs`. */
  framesDone: number;
  /** Total frames the export will produce. */
  totalFrames: number;
  /** Wall-clock time of this sample (e.g. `performance.now()`), in ms. */
  atMs: number;
}

/** A moving-average ETA (ms) from a bounded window of recent timing samples; null when there isn't enough data yet. */
export function estimateEta(samples: readonly FrameTimingSample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedMs = last.atMs - first.atMs;
  const framesDone = last.framesDone - first.framesDone;
  if (elapsedMs <= 0 || framesDone <= 0) return null;
  const msPerFrame = elapsedMs / framesDone;
  const framesRemaining = Math.max(0, last.totalFrames - last.framesDone);
  return Math.round(msPerFrame * framesRemaining);
}
