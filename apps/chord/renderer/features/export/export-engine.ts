// The mediabunny-facing export encoder. build-frame-scene.ts / chord-stage.tsx
// are the single source of truth for what a frame looks like; everything
// mediabunny-specific (containers, codecs, samples, streaming) stays local to
// this file. Pure planning helpers (frame counts, codec selection, ETA) live
// in export-plan.ts and are what this file's decisions are tested against.
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type Konva from 'konva';
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  CanvasSource,
  Conversion,
  ConversionCanceledError,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type OutputFormat,
  type StreamTargetChunk,
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import type { ChordProject } from '../../../shared/project';
import { estimateBitrate, type ExportAudioCodec, type ExportContainer, type ExportSettings, type ExportVideoCodec } from '../../../shared/export-presets';
import { buildFrameScene, resolveTimelineEndMs } from '../canvas/build-frame-scene';
import { ChordStage } from '../canvas/chord-stage';
import {
  audioCodecsForContainer,
  estimateAudioBitrate,
  estimateEta,
  pickAudioCodec,
  pickVideoCodec,
  planFrames,
  videoCodecsForContainer,
  type FrameTimingSample,
} from './export-plan';

// Registers the software AAC/MP3 encoders once, and only when the platform
// has no native encoder for that codec, so this rarely overrides a better
// native path. Fired at module load (not lazily inside `runExport`) so the
// check is already resolved by the time any export starts; `runExport` still
// awaits it defensively.
const encodersReady: Promise<void> = (async () => {
  const [hasAac, hasMp3] = await Promise.all([canEncodeAudio('aac'), canEncodeAudio('mp3')]);
  if (!hasAac) registerAacEncoder();
  if (!hasMp3) registerMp3Encoder();
})();

export interface ExportSink {
  write(position: number, bytes: Uint8Array): Promise<void>;
}

export type ExportStage = 'preparing' | 'rendering' | 'finalizing';

export interface ExportProgress {
  percent: number;
  etaMs: number | null;
  stage: ExportStage;
}

export interface RunExportInput {
  project: ChordProject;
  settings: ExportSettings;
  audioUrl: string | null;
  backgroundUrl: string | null;
  sink: ExportSink;
  onProgress: (progress: ExportProgress) => void;
  signal: AbortSignal;
}

const EXPORT_SLIDE_ID = 'chord-export';
const TIMING_WINDOW = 30;

// ── Off-DOM frame renderer ──────────────────────────────────────────────
// Mounts ChordStage into a detached, hidden container via createRoot, and
// exposes a synchronous `renderAt` that flushes a render and hands back the
// layer's live canvas element for the encoder to read from.

interface FrameRenderer {
  renderAt(timeMs: number, backgroundFrame: CanvasImageSource | null): HTMLCanvasElement;
  dispose(): void;
}

function mountFrameRenderer(project: ChordProject, backgroundUrl: string | null, width: number, height: number): FrameRenderer {
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const stageRef: { current: Konva.Stage | null } = { current: null };
  let pinnedPixelRatio = false;

  function renderAt(timeMs: number, backgroundFrame: CanvasImageSource | null): HTMLCanvasElement {
    const scene = buildFrameScene(project, timeMs, { slideId: EXPORT_SLIDE_ID, backgroundUrl });
    flushSync(() => {
      root.render(createElement(ChordStage, { scene, viewport: { width, height }, backgroundFrame, stageRef }));
    });
    const stage = stageRef.current;
    if (!stage) throw new Error('Export render surface failed to mount.');
    const layer = stage.getLayers()[0];
    if (!pinnedPixelRatio) {
      // Match the encoder's requested pixel dimensions exactly regardless of
      // the OS's device pixel ratio; otherwise a Retina host would encode a
      // frame at 2x (or 3x) the configured export resolution.
      const canvas = layer.getCanvas();
      if (canvas.getPixelRatio() !== 1) canvas.setPixelRatio(1);
      pinnedPixelRatio = true;
    }
    layer.batchDraw();
    return layer.getNativeCanvasElement();
  }

  function dispose(): void {
    root.unmount();
    container.remove();
  }

  return { renderAt, dispose };
}

// ── Background frame source ──────────────────────────────────────────────
// Pre-decodes the background media once so the tight per-frame export loop
// never awaits media decoding.

interface BackgroundFrameSource {
  getFrame(timeS: number): CanvasImageSource | null;
  dispose(): void;
}

const NO_BACKGROUND_FRAME: BackgroundFrameSource = { getFrame: () => null, dispose() {} };

interface DecodedBackgroundFrame {
  timestampS: number;
  canvas: HTMLCanvasElement;
}

function findBackgroundFrame(frames: readonly DecodedBackgroundFrame[], timeS: number): HTMLCanvasElement | null {
  if (frames.length === 0) return null;
  if (timeS <= frames[0].timestampS) return frames[0].canvas;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].timestampS <= timeS) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo].canvas;
}

async function decodeBackgroundVideoFrames(sink: VideoSampleSink, endS: number): Promise<DecodedBackgroundFrame[]> {
  const frames: DecodedBackgroundFrame[] = [];
  for await (const sample of sink.samples(0, endS)) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sample.displayWidth));
    canvas.height = Math.max(1, Math.round(sample.displayHeight));
    const ctx = canvas.getContext('2d');
    if (ctx) sample.draw(ctx, 0, 0, canvas.width, canvas.height);
    frames.push({ timestampS: sample.timestamp, canvas });
    sample.close();
  }
  return frames;
}

/**
 * Pre-decodes the background once: an image is a single bitmap; a video is
 * decoded across one loop cycle (or the whole export duration when not
 * looping) via a single forward `VideoSampleSink.samples()` pass, then
 * looked up per output frame by binary search — frame-accurate, and handles
 * looping with a plain modulo instead of seeking the sink backwards mid-export.
 * Memory cost is bounded by that one cycle's frame count, which is fine for
 * the short loops a lyric-video background typically is; a very long,
 * non-looping background video would want a streaming redesign instead.
 */
async function prepareBackgroundFrameSource(project: ChordProject, backgroundUrl: string | null, durationS: number): Promise<BackgroundFrameSource> {
  const background = project.background;
  if (background.kind === 'color' || !backgroundUrl) return NO_BACKGROUND_FRAME;

  const blob = await (await fetch(backgroundUrl)).blob();

  if (background.kind === 'image') {
    const bitmap = await createImageBitmap(blob);
    return { getFrame: () => bitmap, dispose: () => bitmap.close() };
  }

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) {
    input.dispose();
    return NO_BACKGROUND_FRAME;
  }
  const bgDurationS = await track.computeDuration();
  const cycleEndS = background.loop || bgDurationS <= 0 ? bgDurationS : Math.min(bgDurationS, durationS);
  const frames = cycleEndS > 0 ? await decodeBackgroundVideoFrames(new VideoSampleSink(track), cycleEndS) : [];
  input.dispose();

  return {
    getFrame(timeS: number) {
      if (frames.length === 0) return null;
      const bgTimeS = background.loop && bgDurationS > 0 ? timeS % bgDurationS : Math.min(timeS, cycleEndS);
      return findBackgroundFrame(frames, bgTimeS);
    },
    dispose() {
      // Plain canvases have no explicit release step; dropping every
      // reference here lets them be garbage-collected.
      frames.length = 0;
    },
  };
}

// ── Codec selection: mediabunny capability probing over export-plan's pure picks ──

function outputFormatFor(container: ExportContainer): OutputFormat {
  switch (container) {
    case 'mp4':
      return new Mp4OutputFormat();
    case 'mov':
      return new MovOutputFormat();
    case 'webm':
      return new WebMOutputFormat();
    case 'mkv':
      return new MkvOutputFormat();
    default: {
      const exhaustive: never = container;
      throw new Error(`Unknown export container "${String(exhaustive)}".`);
    }
  }
}

async function encodableOf<T extends string>(codecs: readonly T[], check: (codec: T) => Promise<boolean>): Promise<T[]> {
  const results = await Promise.all(codecs.map(async (codec) => ({ codec, ok: await check(codec) })));
  return results.filter((entry) => entry.ok).map((entry) => entry.codec);
}

async function resolveVideoCodec(
  container: ExportContainer,
  requested: ExportVideoCodec,
  width: number,
  height: number,
  fps: number,
): Promise<ExportVideoCodec> {
  const candidates = videoCodecsForContainer(container);
  const encodable = await encodableOf(candidates, (codec) => canEncodeVideo(codec, { width, height, frameRate: fps }));
  const picked = pickVideoCodec(container, requested, encodable);
  if (!picked) throw new Error(`This machine can't encode any video codec supported by the ${container.toUpperCase()} container.`);
  return picked;
}

async function resolveAudioCodec(container: ExportContainer, requested: ExportAudioCodec): Promise<ExportAudioCodec | null> {
  const candidates = audioCodecsForContainer(container);
  const encodable = await encodableOf(candidates, (codec) => canEncodeAudio(codec));
  return pickAudioCodec(container, requested, encodable);
}

// ── Output sink wiring ───────────────────────────────────────────────────

function createStreamTarget(sink: ExportSink): StreamTarget {
  const writable = new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      await sink.write(chunk.position, chunk.data);
    },
  });
  return new StreamTarget(writable, { chunked: true, chunkSize: 8 * 1024 * 1024 });
}

// ── Video export ─────────────────────────────────────────────────────────

async function runVideoExport(input: RunExportInput): Promise<void> {
  const { project, settings, audioUrl, backgroundUrl, sink, onProgress, signal } = input;
  if (settings.kind !== 'video') throw new Error('runVideoExport requires video settings.');
  if (signal.aborted) return;
  await encodersReady;
  if (signal.aborted) return;

  onProgress({ percent: 0, etaMs: null, stage: 'preparing' });

  const durationMs = resolveTimelineEndMs(project);
  const { count: frameCount, frameDurationS } = planFrames(durationMs, settings.fps);
  const videoCodec = await resolveVideoCodec(settings.container, settings.videoCodec, settings.width, settings.height, settings.fps);
  const audioCodec = settings.includeAudio && audioUrl ? await resolveAudioCodec(settings.container, settings.audioCodec) : null;
  const bitrate = estimateBitrate(settings.width, settings.height, settings.fps, settings.quality);

  const output = new Output({ format: outputFormatFor(settings.container), target: createStreamTarget(sink) });
  const renderer = mountFrameRenderer(project, backgroundUrl, settings.width, settings.height);
  const backgroundSource = await prepareBackgroundFrameSource(project, backgroundUrl, durationMs / 1000);

  const onAbort = () => {
    void output.cancel();
  };
  signal.addEventListener('abort', onAbort);

  try {
    if (signal.aborted) {
      await output.cancel();
      return;
    }

    const initialCanvas = renderer.renderAt(0, backgroundSource.getFrame(0));
    const videoSource = new CanvasSource(initialCanvas, { codec: videoCodec, bitrate });
    output.addVideoTrack(videoSource, { frameRate: settings.fps });

    let audioSource: AudioBufferSource | null = null;
    if (audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: estimateAudioBitrate(settings.quality) });
      output.addAudioTrack(audioSource);
    }

    await output.start();
    onProgress({ percent: 0, etaMs: null, stage: 'rendering' });

    const timingSamples: FrameTimingSample[] = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (signal.aborted) return;
      const timeS = frameIndex * frameDurationS;
      if (frameIndex > 0) renderer.renderAt(timeS * 1000, backgroundSource.getFrame(timeS));
      await videoSource.add(timeS, frameDurationS);

      timingSamples.push({ framesDone: frameIndex + 1, totalFrames: frameCount, atMs: performance.now() });
      if (timingSamples.length > TIMING_WINDOW) timingSamples.shift();
      onProgress({
        percent: Math.round(((frameIndex + 1) / frameCount) * 100),
        etaMs: estimateEta(timingSamples),
        stage: 'rendering',
      });
    }

    if (audioSource && audioUrl) {
      const audioBlob = await (await fetch(audioUrl)).blob();
      const audioInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(audioBlob) });
      const audioTrack = await audioInput.getPrimaryAudioTrack();
      if (audioTrack) {
        const bufferSink = new AudioBufferSink(audioTrack);
        for await (const { buffer } of bufferSink.buffers()) {
          if (signal.aborted) break;
          await audioSource.add(buffer);
        }
      }
      audioInput.dispose();
    }

    if (signal.aborted) return;
    onProgress({ percent: 100, etaMs: 0, stage: 'finalizing' });
    await output.finalize();
  } finally {
    signal.removeEventListener('abort', onAbort);
    renderer.dispose();
    backgroundSource.dispose();
  }
}

// ── Audio-only export (mediabunny's Conversion drives the whole pipeline) ──

async function runAudioExport(input: RunExportInput): Promise<void> {
  const { settings, audioUrl, sink, onProgress, signal } = input;
  if (settings.kind !== 'audio') throw new Error('runAudioExport requires audio settings.');
  if (!audioUrl) throw new Error('There is no audio to export.');
  if (signal.aborted) return;
  await encodersReady;
  if (signal.aborted) return;

  onProgress({ percent: 0, etaMs: null, stage: 'preparing' });

  const blob = await (await fetch(audioUrl)).blob();
  const audioInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const format = settings.format === 'wav' ? new WavOutputFormat() : settings.format === 'mp3' ? new Mp3OutputFormat() : new Mp4OutputFormat();
  const output = new Output({ format, target: createStreamTarget(sink) });

  const codec: AudioCodec | undefined = settings.format === 'wav' ? undefined : settings.format === 'mp3' ? 'mp3' : 'aac';
  const bitrate = estimateAudioBitrate(settings.quality);

  const conversion = await Conversion.init({
    input: audioInput,
    output,
    video: { discard: true },
    audio: codec ? { codec, bitrate } : {},
  });

  if (!conversion.isValid) {
    audioInput.dispose();
    throw new Error('This audio could not be converted to the requested format.');
  }

  conversion.onProgress = (progress) => {
    onProgress({ percent: Math.round(progress * 100), etaMs: null, stage: 'rendering' });
  };

  const onAbort = () => {
    void conversion.cancel();
  };
  signal.addEventListener('abort', onAbort);

  try {
    if (signal.aborted) {
      await conversion.cancel();
      return;
    }
    onProgress({ percent: 0, etaMs: null, stage: 'rendering' });
    try {
      await conversion.execute();
    } catch (error) {
      if (error instanceof ConversionCanceledError) return;
      throw error;
    }
    if (signal.aborted) return;
    onProgress({ percent: 100, etaMs: 0, stage: 'finalizing' });
  } finally {
    signal.removeEventListener('abort', onAbort);
    audioInput.dispose();
  }
}

// ── Image export ─────────────────────────────────────────────────────────

async function runImageExport(input: RunExportInput): Promise<void> {
  const { project, settings, backgroundUrl, sink, onProgress, signal } = input;
  if (settings.kind !== 'image') throw new Error('runImageExport requires image settings.');
  if (signal.aborted) return;

  onProgress({ percent: 0, etaMs: null, stage: 'preparing' });
  const { width, height } = project.composition;
  const backgroundSource = await prepareBackgroundFrameSource(project, backgroundUrl, settings.timeMs / 1000);
  const renderer = mountFrameRenderer(project, backgroundUrl, width, height);

  try {
    if (signal.aborted) return;
    onProgress({ percent: 40, etaMs: null, stage: 'rendering' });
    const frame = backgroundSource.getFrame(settings.timeMs / 1000);
    const canvas = renderer.renderAt(settings.timeMs, frame);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to encode the exported image.');
    if (signal.aborted) return;

    onProgress({ percent: 90, etaMs: null, stage: 'finalizing' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await sink.write(0, bytes);
    onProgress({ percent: 100, etaMs: 0, stage: 'finalizing' });
  } finally {
    renderer.dispose();
    backgroundSource.dispose();
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export async function runExport(input: RunExportInput): Promise<void> {
  if (input.settings.kind === 'image') return runImageExport(input);
  if (input.settings.kind === 'audio') return runAudioExport(input);
  return runVideoExport(input);
}
