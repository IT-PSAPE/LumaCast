import { ALL_FORMATS, Input, UrlSource, VideoSampleSink, type VideoSample } from 'mediabunny';
import type { ChordProject } from '../../../shared/project';

// This bounds only our two RGBA canvas surfaces, not browser/codec memory.
const MAX_CANVAS_BYTES = 128 * 1024 * 1024;
const SOURCE_CACHE_BYTES = 8 * 1024 * 1024;

export interface BackgroundFrameSource {
  getFrame(timeS: number): Promise<CanvasImageSource | null>;
  dispose(): Promise<void>;
}

const NO_BACKGROUND: BackgroundFrameSource = { getFrame: async () => null, dispose: async () => {} };

function checkSize(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width * height * 4 * 2 > MAX_CANVAS_BYTES) {
    throw new Error('The background video exceeds the 128 MiB export frame-surface limit.');
  }
}

/** Forward decoding retains two samples and alternates two reusable surfaces.
 * Rewind starts another bounded pass; clip length never grows our frame cache.
 */
export async function prepareBackgroundFrameSource(
  project: ChordProject, url: string | null, signal: AbortSignal,
): Promise<BackgroundFrameSource> {
  signal.throwIfAborted();
  if (project.background.kind === 'color' || !url) return NO_BACKGROUND;
  if (project.background.kind === 'image') {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('The background image could not be read.');
    const blob = await response.blob();
    signal.throwIfAborted();
    const bitmap = await createImageBitmap(blob);
    let closed = false;
    const close = () => { if (!closed) { closed = true; bitmap.close(); } };
    if (signal.aborted) { close(); signal.throwIfAborted(); }
    return {
      async getFrame() { signal.throwIfAborted(); return bitmap; },
      // A mounted renderer can still reference this bitmap during a held add.
      async dispose() { close(); },
    };
  }

  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(url, { maxCacheSize: SOURCE_CACHE_BYTES, getRetryDelay: () => null }),
  });
  let iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
  let current: VideoSample | null = null;
  let lookahead: VideoSample | null = null;
  let ended = false;
  let disposed = false;
  let inputDisposed = false;
  let cleanup: Promise<void> | null = null;
  let lastTime = -Infinity;
  let canvasIndex = 0;
  const canvases: HTMLCanvasElement[] = [];
  const disposeInput = () => { if (!inputDisposed) { inputDisposed = true; input.dispose(); } };
  const releaseSamples = () => { current?.close(); lookahead?.close(); current = null; lookahead = null; };
  const dispose = (): Promise<void> => {
    if (cleanup) return cleanup;
    disposed = true;
    signal.removeEventListener('abort', onAbort);
    // Disposing Input interrupts pending reads/next() before we await return().
    disposeInput();
    releaseSamples();
    for (const canvas of canvases) { canvas.width = 0; canvas.height = 0; }
    const previous = iterator;
    iterator = null;
    return cleanup = (async () => { await previous?.return(); })();
  };
  // Interrupt decoding immediately, but retain consumer-visible surfaces until
  // the owner has unmounted its renderer and explicitly disposes this source.
  const onAbort = () => { disposeInput(); };
  signal.addEventListener('abort', onAbort);

  try {
    signal.throwIfAborted();
    const track = await input.getPrimaryVideoTrack();
    signal.throwIfAborted();
    if (!track) { await dispose(); return NO_BACKGROUND; }
    const [durationS, width, height, timeResolution] = await Promise.all([
      track.computeDuration(), track.getDisplayWidth(), track.getDisplayHeight(), track.getTimeResolution(),
    ]);
    signal.throwIfAborted();
    if (!Number.isFinite(durationS) || durationS < 0) throw new Error('The background video has an invalid duration.');
    if (durationS === 0) { await dispose(); return NO_BACKGROUND; }
    const sourceTickS = 1 / timeResolution;
    if (!Number.isFinite(timeResolution) || timeResolution <= 0 || !Number.isFinite(sourceTickS) || sourceTickS <= 0)
      throw new Error('The background video has an invalid timebase.');
    checkSize(Math.round(width), Math.round(height));
    const sink = new VideoSampleSink(track);
    const loop = project.background.loop;

    const nextSample = async (): Promise<VideoSample | null> => {
      if (ended || !iterator) return null;
      const result = await iterator.next();
      if (signal.aborted || disposed) {
        if (!result.done) result.value.close();
        signal.throwIfAborted();
        throw new Error('The export background has been disposed.');
      }
      ended = result.done ?? false;
      return result.done ? null : result.value;
    };

    return {
      async getFrame(timeS) {
        signal.throwIfAborted();
        if (disposed) throw new Error('The export background has been disposed.');
        if (!Number.isFinite(timeS)) throw new Error('The background frame timestamp must be finite.');
        let time = loop ? timeS % durationS : Math.min(timeS, durationS);
        // Frame-grid division/modulo and decoded timestamps can differ by a few
        // representable values at an exact boundary. This is not a frame-sized
        // tolerance: reject clocks whose uncertainty could swallow half a tick.
        const scale = Math.max(Math.abs(loop ? timeS : time), durationS);
        const uncertainty = 8 * Math.max(Number.MIN_VALUE, Number.EPSILON * scale);
        if (uncertainty >= Math.min(durationS, sourceTickS) / 2)
          throw new Error('The background timestamp cannot be resolved at this video timebase.');
        if (loop && (Math.abs(time) <= uncertainty || Math.abs(durationS - time) <= uncertainty)) time = 0;
        if (!iterator || time < lastTime) {
          releaseSamples();
          await iterator?.return();
          signal.throwIfAborted();
          if (disposed) throw new Error('The export background has been disposed.');
          ended = false;
          iterator = sink.samples(0, durationS);
          current = await nextSample();
          lookahead = await nextSample();
        }
        lastTime = time;
        while (lookahead && lookahead.timestamp <= time + uncertainty) {
          current?.close();
          current = lookahead;
          lookahead = null;
          lookahead = await nextSample();
        }
        if (!current) return null;
        const width = Math.max(1, Math.round(current.displayWidth));
        const height = Math.max(1, Math.round(current.displayHeight));
        checkSize(width, height);
        const index = canvasIndex++ % 2;
        const canvas = canvases[index] ??= document.createElement('canvas');
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const context = canvas.getContext('2d');
        if (!context) throw new Error('The export background surface could not be created.');
        context.clearRect(0, 0, width, height);
        current.draw(context, 0, 0, width, height);
        return canvas;
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
