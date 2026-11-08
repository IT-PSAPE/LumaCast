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
  UrlSource,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type OutputFormat,
  type StreamTargetChunk,
  type WrappedAudioBuffer,
} from 'mediabunny';
import { registerAacEncoder } from '@mediabunny/aac-encoder';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import type { ChordProject } from '../../../shared/project';
import { estimateBitrate, type ExportAudioCodec, type ExportContainer, type ExportSettings, type ExportVideoCodec } from '../../../shared/export-presets';
import { buildFrameScene, resolveTimelineEndMs } from '../../rendering/build-frame-scene';
import { ChordStage } from '../../rendering/chord-stage';
import { prepareBackgroundFrameSource, type BackgroundFrameSource } from './background-frame-source';
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
const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;

function mediaInput(url: string): Input {
  return new Input({ formats: ALL_FORMATS, source: new UrlSource(url, {
    maxCacheSize: SOURCE_CACHE_BYTES, getRetryDelay: () => null,
  }) });
}

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
  let root: Root;
  try { root = createRoot(container); }
  catch (error) { container.remove(); throw error; }
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
    // CanvasSource snapshots immediately; a deferred batchDraw can encode the
    // preceding frame (or a blank first frame) rather than this timestamp.
    layer.draw();
    return layer.getNativeCanvasElement();
  }

  function dispose(): void {
    try { root.unmount(); }
    finally { container.remove(); }
  }

  return { renderAt, dispose };
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
  signal.throwIfAborted();

  const output = new Output({ format: outputFormatFor(settings.container), target: createStreamTarget(sink) });
  let renderer: FrameRenderer | null = null;
  let backgroundSource: BackgroundFrameSource | null = null;
  let audioInput: Input | null = null;
  let audioBuffers: AsyncGenerator<WrappedAudioBuffer, void, unknown> | null = null;
  let completed = false;
  let cancellation: Promise<void> | null = null;
  const cancel = () => cancellation ??= output.cancel().catch(() => {});
  const disposeAudio = () => { audioInput?.dispose(); audioInput = null; };
  const onAbort = () => { disposeAudio(); void cancel(); };
  signal.addEventListener('abort', onAbort);

  try {
    renderer = mountFrameRenderer(project, backgroundUrl, settings.width, settings.height);
    backgroundSource = await prepareBackgroundFrameSource(project, backgroundUrl, signal);
    signal.throwIfAborted();

    const initialFrame = await backgroundSource.getFrame(0);
    signal.throwIfAborted();
    const initialCanvas = renderer.renderAt(0, initialFrame);
    const videoSource = new CanvasSource(initialCanvas, { codec: videoCodec, bitrate });
    output.addVideoTrack(videoSource, { frameRate: settings.fps });

    let audioSource: AudioBufferSource | null = null;
    if (audioCodec && audioUrl) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: estimateAudioBitrate(settings.quality) });
      output.addAudioTrack(audioSource);
      audioInput = mediaInput(audioUrl);
      const audioTrack = await audioInput.getPrimaryAudioTrack();
      signal.throwIfAborted();
      if (audioTrack) audioBuffers = new AudioBufferSink(audioTrack).buffers();
    }

    await output.start();
    signal.throwIfAborted();
    onProgress({ percent: 0, etaMs: null, stage: 'rendering' });

    let audioTimeS = 0;
    let audioEnded = !audioSource;
    const feedAudioUntil = async (endS: number) => {
      while (audioSource && !audioEnded && audioTimeS < endS) {
        signal.throwIfAborted();
        const next = await audioBuffers?.next();
        signal.throwIfAborted();
        if (!next || next.done) {
          audioEnded = true;
          // Await the patched public EOF promise before proceeding. An ended
          // track must release the muxer's interleave gate for the other tail.
          await audioSource.close();
          signal.throwIfAborted();
          break;
        }
        await audioSource.add(next.value.buffer);
        signal.throwIfAborted();
        // Preserve AudioBufferSource's original contiguous timeline from zero.
        audioTimeS += next.value.buffer.duration;
      }
    };

    const timingSamples: FrameTimingSample[] = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      signal.throwIfAborted();
      const timeS = frameIndex / settings.fps;
      if (frameIndex > 0) {
        const frame = await backgroundSource.getFrame(timeS);
        signal.throwIfAborted();
        renderer.renderAt(timeS * 1000, frame);
      }
      await videoSource.add(timeS, frameDurationS);
      signal.throwIfAborted();
      await feedAudioUntil((frameIndex + 1) / settings.fps);

      timingSamples.push({ framesDone: frameIndex + 1, totalFrames: frameCount, atMs: performance.now() });
      if (timingSamples.length > TIMING_WINDOW) timingSamples.shift();
      onProgress({
        percent: Math.round(((frameIndex + 1) / frameCount) * 100),
        etaMs: estimateEta(timingSamples),
        stage: 'rendering',
      });
    }

    await videoSource.close();
    signal.throwIfAborted();
    await feedAudioUntil(Infinity);
    signal.throwIfAborted();
    onProgress({ percent: 100, etaMs: 0, stage: 'finalizing' });
    await output.finalize();
    completed = true;
  } finally {
    signal.removeEventListener('abort', onAbort);
    disposeAudio();
    try { renderer?.dispose(); }
    finally {
      try { await backgroundSource?.dispose(); }
      finally {
        try { await audioBuffers?.return(); }
        finally { if (!completed) await cancel(); }
      }
    }
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

  signal.throwIfAborted();
  const audioInput = mediaInput(audioUrl);
  const format = settings.format === 'wav' ? new WavOutputFormat() : settings.format === 'mp3' ? new Mp3OutputFormat() : new Mp4OutputFormat();
  let output: Output;
  try { output = new Output({ format, target: createStreamTarget(sink) }); }
  catch (error) { audioInput.dispose(); throw error; }

  const codec: AudioCodec | undefined = settings.format === 'wav' ? undefined : settings.format === 'mp3' ? 'mp3' : 'aac';
  const bitrate = estimateAudioBitrate(settings.quality);

  let conversion: Conversion | null = null;
  let completed = false;
  let cancellation: Promise<void> | null = null;
  const cancel = () => cancellation ??= (conversion ? conversion.cancel() : output.cancel()).catch(() => {});
  const onAbort = () => { audioInput.dispose(); void cancel(); };
  signal.addEventListener('abort', onAbort);

  try {
    signal.throwIfAborted();
    conversion = await Conversion.init({ input: audioInput, output, video: { discard: true }, audio: codec ? { codec, bitrate } : {} });
    signal.throwIfAborted();
    if (!conversion.isValid) throw new Error('This audio could not be converted to the requested format.');
    conversion.onProgress = (progress) => {
      if (!signal.aborted) onProgress({ percent: Math.round(progress * 100), etaMs: null, stage: 'rendering' });
    };
    onProgress({ percent: 0, etaMs: null, stage: 'rendering' });
    try {
      await conversion.execute();
    } catch (error) {
      if (error instanceof ConversionCanceledError && signal.aborted) return;
      throw error;
    }
    signal.throwIfAborted();
    onProgress({ percent: 100, etaMs: 0, stage: 'finalizing' });
    completed = true;
  } finally {
    signal.removeEventListener('abort', onAbort);
    audioInput.dispose();
    if (!completed) await cancel();
  }
}

// ── Image export ─────────────────────────────────────────────────────────

async function runImageExport(input: RunExportInput): Promise<void> {
  const { project, settings, backgroundUrl, sink, onProgress, signal } = input;
  if (settings.kind !== 'image') throw new Error('runImageExport requires image settings.');
  if (signal.aborted) return;

  onProgress({ percent: 0, etaMs: null, stage: 'preparing' });
  const { width, height } = project.composition;
  let backgroundSource: BackgroundFrameSource | null = null;
  let renderer: FrameRenderer | null = null;

  try {
    backgroundSource = await prepareBackgroundFrameSource(project, backgroundUrl, signal);
    renderer = mountFrameRenderer(project, backgroundUrl, width, height);
    signal.throwIfAborted();
    onProgress({ percent: 40, etaMs: null, stage: 'rendering' });
    const frame = await backgroundSource.getFrame(settings.timeMs / 1000);
    signal.throwIfAborted();
    const canvas = renderer.renderAt(settings.timeMs, frame);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to encode the exported image.');
    signal.throwIfAborted();

    onProgress({ percent: 90, etaMs: null, stage: 'finalizing' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    signal.throwIfAborted();
    await sink.write(0, bytes);
    signal.throwIfAborted();
    onProgress({ percent: 100, etaMs: 0, stage: 'finalizing' });
  } finally {
    try { renderer?.dispose(); }
    finally { await backgroundSource?.dispose(); }
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export async function runExport(input: RunExportInput): Promise<void> {
  if (input.settings.kind === 'image') return runImageExport(input);
  if (input.settings.kind === 'audio') return runAudioExport(input);
  return runVideoExport(input);
}
