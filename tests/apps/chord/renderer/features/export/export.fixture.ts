import {
  ALL_FORMATS, AudioBufferSink, BlobSource, BufferTarget, CanvasSource, Input, Output,
  VideoSample, VideoSampleSink, WebMOutputFormat,
} from 'mediabunny';
import { createEmptyProject } from '../../../../../../apps/chord/shared/project-schema';
import { prepareBackgroundFrameSource } from '../../../../../../apps/chord/renderer/features/export/background-frame-source';
import { runExport } from '../../../../../../apps/chord/renderer/features/export/export-engine';

declare global { interface Window { __chordExportProof?: Record<string, unknown> } }

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const palette = [[240, 20, 20], [20, 220, 20], [20, 20, 240]];
type Stats = { samples: Set<VideoSample>; peakSamples: number; frames: Set<VideoFrame>; peakFrames: number; canvases: Set<HTMLCanvasElement>; peakCanvasBytes: number; draws: number; decoderCyclePeaks: Record<number, number> };
type MuxStats = { packets: number; bytes: number; observations: number };
let stats: Stats | null = null;
let muxStats: MuxStats | null = null;
const traceMode = new URL(location.href).searchParams.has('trace');
const traceRows: { requested: number; sourceTimestamp: number; sourceMarker: number; canvasMarker: number; encodedMarker?: number }[] = [];
let latestSourceTimestamp = 0, latestSourceMarker = 0;
let diagnosticDuration = 0;
const traceCanvas = document.createElement('canvas'); traceCanvas.width = 320; traceCanvas.height = 180;
const frameOwners = new WeakMap<VideoFrame, Stats>();
const NativeDecoder = globalThis.VideoDecoder;
globalThis.VideoDecoder = class extends NativeDecoder {
  constructor(init: VideoDecoderInit) {
    super({ ...init, output(frame) {
      if (stats) {
        stats.frames.add(frame); frameOwners.set(frame, stats); stats.peakFrames = Math.max(stats.peakFrames, stats.frames.size);
        const cycle = Math.floor(stats.draws / 90);
        stats.decoderCyclePeaks[cycle] = Math.max(stats.decoderCyclePeaks[cycle] ?? 0, stats.frames.size);
      }
      init.output(frame);
    } });
  }
};
const closeFrame = VideoFrame.prototype.close;
VideoFrame.prototype.close = function () { frameOwners.get(this)?.frames.delete(this); closeFrame.call(this); };
const closeSample = VideoSample.prototype.close;
VideoSample.prototype.close = function () { stats?.samples.delete(this); closeSample.call(this); };
const draw = VideoSample.prototype.draw;
VideoSample.prototype.draw = function (this: VideoSample, ...args: unknown[]) {
  stats?.canvases.add((args[0] as CanvasRenderingContext2D).canvas);
  if (stats) stats.peakCanvasBytes = Math.max(stats.peakCanvasBytes, [...stats.canvases].reduce((sum, canvas) => sum + canvas.width * canvas.height * 4, 0));
  if (stats) stats.draws++;
  const result = Reflect.apply(draw, this, args);
  if (stats && traceMode) {
    latestSourceTimestamp = this.timestamp;
    traceCanvas.getContext('2d')!.drawImage((args[0] as CanvasRenderingContext2D).canvas, 0, 0, 320, 180);
    latestSourceMarker = readMarker(traceCanvas);
  }
  return result;
} as typeof draw;
const addCanvas = CanvasSource.prototype.add;
CanvasSource.prototype.add = function (...args) {
  if (stats && traceMode) traceRows.push({ requested: args[0], sourceTimestamp: latestSourceTimestamp, sourceMarker: latestSourceMarker, canvasMarker: readMarker((this as unknown as { _canvas: HTMLCanvasElement })._canvas) });
  return addCanvas.apply(this, args);
};
const samples = VideoSampleSink.prototype.samples;
VideoSampleSink.prototype.samples = async function* (...args) {
  for await (const sample of samples.apply(this, args)) {
    if (stats) { stats.samples.add(sample); stats.peakSamples = Math.max(stats.peakSamples, stats.samples.size); }
    yield sample;
  }
};

// Test-only observation of installed Matroska payload queues, delegated without
// changing packet admission/results. These internals are never used by the app.
const startOutput = Output.prototype.start;
Output.prototype.start = async function () {
  await startOutput.call(this);
  const observed = muxStats;
  if (!observed) return;
  const muxer = (this as unknown as { _muxer: Record<string, unknown> })._muxer;
  const record = () => {
    const tracks = muxer.trackDatas as { chunkQueue: { data: Uint8Array }[] }[];
    check(Array.isArray(tracks), 'Installed Matroska queue observation is unsupported');
    const packets = tracks.flatMap((track) => track.chunkQueue);
    observed.packets = Math.max(observed.packets, packets.length);
    observed.bytes = Math.max(observed.bytes, packets.reduce((sum, packet) => sum + packet.data.byteLength, 0));
    observed.observations++;
  };
  for (const name of ['addEncodedVideoPacket', 'addEncodedAudioPacket']) {
    const method = muxer[name] as (...args: unknown[]) => unknown;
    muxer[name] = function (this: unknown, ...args: unknown[]) {
      return Promise.resolve(Reflect.apply(method, this, args)).then((value) => { record(); return value; });
    };
  }
};

function observe() { return stats = { samples: new Set(), peakSamples: 0, frames: new Set(), peakFrames: 0, canvases: new Set(), peakCanvasBytes: 0, draws: 0, decoderCyclePeaks: {} }; }
async function released(observed: Stats) {
  for (let i = 0; i < 50 && observed.frames.size > 0; i++) await wait(10);
  check(observed.samples.size === 0, `${observed.samples.size} samples retained after disposal`);
  check(observed.frames.size === 0, `${observed.frames.size} decoded frames retained after disposal`);
  check(observed.peakSamples <= 2, `Consumer retained ${observed.peakSamples} samples`);
  check(observed.canvases.size <= 2, `Retained ${observed.canvases.size} background canvases`);
  // This is an observed synthetic-clip guard, not a browser memory guarantee.
  check(observed.peakFrames <= 100, `Decoder leases grew to ${observed.peakFrames} during repeated loops`);
  for (const canvas of observed.canvases) check(canvas.width === 0 && canvas.height === 0, 'Background canvas was not released');
  stats = null;
  return { peakSamples: observed.peakSamples, peakDecoderFrames: observed.peakFrames, decoderCyclePeaks: observed.decoderCyclePeaks, canvases: observed.canvases.size, peakCanvasBytes: observed.peakCanvasBytes };
}

function pixel(source: CanvasImageSource) {
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 16;
  const context = canvas.getContext('2d')!;
  context.drawImage(source, 0, 0, 16, 16);
  return Array.from(context.getImageData(4, 4, 1, 1).data).slice(0, 3);
}

function readMarker(surface: HTMLCanvasElement) {
  const data = surface.getContext('2d')!.getImageData(0, 140, 320, 32).data;
  let actual = 0;
  for (let bit = 0; bit < 7; bit++) if (data[(16 * 320 + 32 + bit * 40) * 4] > 128) actual |= 1 << bit;
  return actual;
}
function checkMarker(surface: HTMLCanvasElement, index: number) {
  const actual = readMarker(surface);
  check(actual === index % 90, `Decoded pixels identify frame ${actual}, expected ${index % 90}`);
}
function color(actual: number[], expected: number[], label: string) {
  check(actual.every((channel, i) => Math.abs(channel - expected[i]) <= 30), `${label}: expected ${expected}, got ${actual}`);
}

function destination() {
  const chunks: { position: number; bytes: Uint8Array }[] = [];
  let pending = 0, peak = 0;
  return {
    peak: () => peak,
    async write(position: number, bytes: Uint8Array) {
      peak = Math.max(peak, ++pending);
      await wait(3);
      chunks.push({ position, bytes: bytes.slice() });
      pending--;
    },
    bytes() {
      const length = Math.max(0, ...chunks.map((chunk) => chunk.position + chunk.bytes.length));
      const bytes = new Uint8Array(length);
      for (const chunk of chunks) bytes.set(chunk.bytes, chunk.position);
      return bytes;
    },
  };
}

function wav(seconds: number): Blob {
  const frames = Math.round(seconds * 48000);
  const bytes = new Uint8Array(44 + frames * 4);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true); view.setUint32(28, 48000 * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 8000);
    view.setInt16(44 + i * 4, sample, true); view.setInt16(46 + i * 4, sample, true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

async function inspectAudioVideo(bytes: Uint8Array<ArrayBuffer>, expectedVideoFrames: number, expectedAudioS: number, expectedFrame: (index: number) => number) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([bytes])) });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    check(video && audio, 'Export lost an audio/video track');
    let frames = 0;
    const surface = document.createElement('canvas'); surface.width = 320; surface.height = 180;
    for await (const sample of new VideoSampleSink(video).samples()) {
      check(Math.abs(sample.timestamp - frames / 30) < 0.001, 'A/V frame timestamps changed');
      sample.draw(surface.getContext('2d')!, 0, 0, 320, 180);
      checkMarker(surface, expectedFrame(frames));
      sample.close(); frames++;
    }
    surface.width = 0; surface.height = 0;
    check(frames === expectedVideoFrames, `A/V export has ${frames} frames, expected ${expectedVideoFrames}`);
    let audioFrames = 0, sampleRate = 0, peak = 0;
    for await (const { buffer } of new AudioBufferSink(audio).buffers()) {
      audioFrames += buffer.length; sampleRate = buffer.sampleRate;
      for (const value of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(value));
    }
    const audioS = audioFrames / sampleRate;
    check(Math.abs(audioS - expectedAudioS) < 0.1, `A/V audio duration ${audioS} differs from ${expectedAudioS}`);
    check(peak > 0.1, 'Exported audio is silent');
    return { frames, audioS, audioPeak: peak, videoCodec: await video.getCodec(), audioCodec: await audio.getCodec() };
  } finally { input.dispose(); }
}

async function proof() {
  document.title = 'Generating synthetic clip';
  check(typeof VideoEncoder !== 'undefined', 'Electron has no WebCodecs encoder');
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext('2d')!;
  const target = new BufferTarget();
  const generated = new Output({ format: new WebMOutputFormat(), target });
  const generator = new CanvasSource(canvas, { codec: 'vp9', bitrate: 2_000_000, hardwareAcceleration: 'prefer-software' });
  generated.addVideoTrack(generator, { frameRate: 30 });
  await generated.start();
  for (let i = 0; i < 90; i++) {
    context.fillStyle = `rgb(${palette[Math.floor(i / 30)].join(',')})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let bit = 0; bit < 7; bit++) {
      context.fillStyle = i & (1 << bit) ? '#f0f0f0' : '#141414';
      context.fillRect(32 + bit * 80, 280, 64, 64);
    }
    await generator.add(i / 30, 1 / 30);
  }
  await generated.finalize();
  document.title = 'Checking background frames';
  const clip = new Blob([target.buffer!], { type: 'video/webm' });
  const reference = new Input({ formats: ALL_FORMATS, source: new BlobSource(clip) });
  const timestamps: number[] = [];
  let clipDuration = 0, resolution = 0;
  try {
    const track = (await reference.getPrimaryVideoTrack())!;
    clipDuration = await track.computeDuration();
    resolution = await track.getTimeResolution();
    for await (const sample of new VideoSampleSink(track).samples()) { timestamps.push(sample.timestamp); sample.close(); }
    check(timestamps.length === 90, 'Generated clip lost source frames');
  } finally { reference.dispose(); }
  const rawFloatFloor = (timeS: number) => {
    const phase = timeS % clipDuration;
    let index = 0;
    while (index + 1 < timestamps.length && timestamps[index + 1] <= phase) index++;
    return index;
  };
  // Independent exact rational oracle: compare integer source ticks against the
  // output frame grid (index / 30), never copy the production floating tolerance.
  check(Number.isSafeInteger(resolution) && resolution > 0, 'Synthetic clip has a noninteger timebase');
  const toTick = (timeS: number) => {
    const value = timeS * resolution;
    const tick = Math.round(value);
    check(Number.isSafeInteger(tick) && Math.abs(tick - value) < 1e-6, 'Synthetic timestamp does not resolve to an integer tick');
    return BigInt(tick);
  };
  const durationTicks = toTick(clipDuration);
  const sourceTicks = timestamps.map(toTick);
  const tickRate = BigInt(resolution);
  const rationalFloor = (numerator: bigint, denominator: bigint) => {
    const phase = numerator % (durationTicks * denominator);
    let index = 0;
    while (index + 1 < sourceTicks.length && sourceTicks[index + 1] * denominator <= phase) index++;
    return index;
  };
  const expectedFrame = (index: number) => rationalFloor(BigInt(index) * tickRate, 30n);
  const expectedMs = (timeMs: number) => rationalFloor(BigInt(timeMs) * tickRate, 1000n);
  const expectedAtTime = (timeS: number) => {
    const ms = Math.round(timeS * 1000);
    check(Math.abs(ms - timeS * 1000) < 1e-6, 'Synthetic time query must have integer milliseconds');
    return expectedMs(ms);
  };
  const url = URL.createObjectURL(clip);
  const project = createEmptyProject('2026-01-01T00:00:00.000Z', 'synthetic-export-proof');
  project.composition = { width: 320, height: 180, fps: 30 };
  project.audio = { path: '/synthetic.wav', name: 'Synthetic duration', durationMs: 6500 };
  project.background = { kind: 'video', media: { path: '/synthetic.webm', name: 'Generated RGB clip', durationMs: 3000 }, loop: true, fit: 'cover', dim: 0, blur: 6 };
  const observations: Record<string, unknown> = {};
  try {
    if (traceMode) {
      const cases: Record<string, unknown> = {};
      project.audio.durationMs = 6500;
      diagnosticDuration = clipDuration;
      for (const blur of [0, 6]) {
        project.background.blur = blur;
        traceRows.length = 0;
        const observed = observe();
        const sink = destination();
        await runExport({ project, settings: { kind: 'video', container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', includeAudio: false, width: 320, height: 180, fps: 30, quality: 'medium' }, audioUrl: null, backgroundUrl: url, sink, signal: new AbortController().signal, onProgress() {} });
        const resources = await released(observed);
        const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([sink.bytes()])) });
        try {
          let index = 0;
          for await (const sample of new VideoSampleSink((await input.getPrimaryVideoTrack())!).samples()) {
            sample.draw(traceCanvas.getContext('2d')!, 0, 0, 320, 180);
            traceRows[index++].encodedMarker = readMarker(traceCanvas);
            sample.close();
          }
        } finally { input.dispose(); }
        cases[`blur${blur}`] = { resources, duration: diagnosticDuration, rows: traceRows.map((row, index) => ({ ...row, index, modulo: row.requested % diagnosticDuration, exactRequestedFloatFloor: rawFloatFloor(row.requested), gridOracle: expectedFrame(index) })) };
      }
      return { ok: true, observations: cases, scope: 'Diagnostic source/render/encode marker trace only; not full pipeline acceptance.' };
    }
    let observed = observe();
    const source = await prepareBackgroundFrameSource(project, url, new AbortController().signal);
    try {
      const times = [0, 0.5, 1, 2, 3, 3.5, 5, 0.2];
      for (const time of times) color(pixel((await source.getFrame(time))!), palette[Math.floor(expectedAtTime(time) / 30)], `background at ${time}s`);
    } finally { await source.dispose(); }
    observations.randomAccess = await released(observed);

    document.title = 'Exporting synthetic video';
    observed = observe();
    const sink = destination();
    await runExport({
      project, settings: { kind: 'video', container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', includeAudio: false, width: 320, height: 180, fps: 30, quality: 'medium' },
      audioUrl: null, backgroundUrl: url, sink, signal: new AbortController().signal, onProgress() {},
    });
    observations.videoResources = await released(observed);
    document.title = 'Checking encoded video';
    const exported = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([sink.bytes()])) });
    try {
      const track = (await exported.getPrimaryVideoTrack())!;
      const decoded = new VideoSampleSink(track);
      let count = 0;
      const surface = document.createElement('canvas'); surface.width = 320; surface.height = 180;
      for await (const frame of decoded.samples()) {
        check(Math.abs(frame.timestamp - count / 30) < 0.001, 'Export frame timestamp changed');
        frame.draw(surface.getContext('2d')!, 0, 0, 320, 180);
        checkMarker(surface, expectedFrame(count));
        count++; frame.close();
      }
      surface.width = 0; surface.height = 0;
      check(count === 195, `Expected 195 exported frames, got ${count}`);
      for (const time of [0, 1.1, 2.1, 3.1, 4.1, 5.1, 6.1]) {
        const frame = (await decoded.getSample(time))!;
        try {
          const surface = document.createElement('canvas'); surface.width = 320; surface.height = 180;
          frame.draw(surface.getContext('2d')!, 0, 0, 320, 180);
          color(pixel(surface), palette[Math.floor(expectedFrame(Math.round(frame.timestamp * 30)) / 30)], `encoded video at ${time}s`);
        } finally { frame.close(); }
      }
      observations.video = { frames: count, bytes: sink.bytes().length, peakSinkWrites: sink.peak() };
      check(sink.peak() === 1, 'Sink writes overlapped');
    } finally { exported.dispose(); }

    for (const timeMs of [2500, 1000, 0]) {
      document.title = `Checking PNG ${timeMs}`;
      observed = observe();
      const png = destination();
      await runExport({ project, settings: { kind: 'image', timeMs }, audioUrl: null, backgroundUrl: url, sink: png, signal: new AbortController().signal, onProgress() {} });
      observations[`pngResources${timeMs}`] = await released(observed);
      const bitmap = await createImageBitmap(new Blob([png.bytes()], { type: 'image/png' }));
      try {
        color(pixel(bitmap), palette[Math.floor(expectedMs(timeMs) / 30)], `PNG at ${timeMs}ms`);
        const surface = document.createElement('canvas'); surface.width = 320; surface.height = 180;
        surface.getContext('2d')!.drawImage(bitmap, 0, 0, 320, 180);
        checkMarker(surface, expectedMs(timeMs));
        surface.width = 0; surface.height = 0;
      }
      finally { bitmap.close(); }
    }

    observed = observe();
    document.title = 'Checking cancellation';
    const controller = new AbortController();
    let aborted = false;
    try {
      await runExport({
        project, settings: { kind: 'video', container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', includeAudio: false, width: 320, height: 180, fps: 30, quality: 'medium' },
        audioUrl: null, backgroundUrl: url, sink: destination(), signal: controller.signal,
        onProgress(progress) { if (progress.stage === 'rendering' && progress.percent >= 3) controller.abort(); },
      });
    } catch { aborted = controller.signal.aborted; }
    check(aborted, 'Decode/export cancellation did not stop the operation');
    observations.abort = await released(observed);
    check(!document.querySelector('[style*="-100000px"]'), 'Export renderer container leaked');

    for (const [container, durationS, audioS] of [['webm', 6.5, 4.5], ['mkv', 24.5, 4.5], ['mp4', 4.5, 6.5]] as const) {
      document.title = `Checking ${container} audio/video`;
      project.audio!.durationMs = durationS * 1000;
      const audioUrl = URL.createObjectURL(wav(audioS));
      observed = observe();
      const queue = { packets: 0, bytes: 0, observations: 0 };
      muxStats = container === 'mp4' ? null : queue;
      const destinationSink = destination();
      try {
        await runExport({
          project, settings: { kind: 'video', container, videoCodec: container === 'mp4' ? 'avc' : 'vp9', audioCodec: container === 'mp4' ? 'aac' : 'opus', includeAudio: true, width: 320, height: 180, fps: 30, quality: 'medium' },
          audioUrl, backgroundUrl: url, sink: destinationSink, signal: new AbortController().signal, onProgress() {},
        });
        const resources = await released(observed);
        muxStats = null;
        const decoded = await inspectAudioVideo(destinationSink.bytes(), Math.ceil(durationS * 30), audioS, expectedFrame);
        if (container !== 'mp4') {
          check(queue.observations > 0, 'No installed mux payload queues were observed');
          check(queue.packets < 60, `Mux payload queue grew to ${queue.packets} packets`);
        }
        check(destinationSink.peak() === 1, 'A/V sink writes overlapped');
        observations[container] = { resources, queue: container === 'mp4' ? null : queue, decoded, bytes: destinationSink.bytes().length, peakSinkWrites: destinationSink.peak() };
      } finally { muxStats = null; stats = null; URL.revokeObjectURL(audioUrl); }
    }
    return { ok: true, observations, scope: 'Synthetic background/video/PNG and interleaved A/V pipeline; no user media or provider.' };
  } finally { URL.revokeObjectURL(url); }
}

void proof().then((result) => { window.__chordExportProof = result; }, (error: unknown) => {
  window.__chordExportProof = { ok: false, error: error instanceof Error ? error.stack : String(error) };
});
