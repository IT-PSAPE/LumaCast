import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestProject } from '../../test-store';
import type { ExportSettings } from '../../../../../../apps/chord/shared/export-presets';

const fake = vi.hoisted(() => ({
  unmount: vi.fn(), dispose: vi.fn(), cancel: vi.fn(async () => {}),
  finalize: vi.fn(async () => {}), add: vi.fn(async () => {}),
  audioAdd: vi.fn(async () => {}), videoClose: vi.fn(async () => {}), audioClose: vi.fn(async () => {}),
  primaryTrack: vi.fn(), conversion: vi.fn(), samples: vi.fn(), buffers: vi.fn(),
}));

vi.mock('react-dom/client', () => ({ createRoot: vi.fn(() => ({
  unmount: fake.unmount,
  render(element: { props: { stageRef: { current: unknown } } }) {
    element.props.stageRef.current = { getLayers: () => [{
      getCanvas: () => ({ getPixelRatio: () => 1 }), draw() {},
      getNativeCanvasElement: () => document.createElement('canvas'),
    }] };
  },
})) }));
vi.mock('react-dom', () => ({ flushSync: (callback: () => void) => callback() }));
vi.mock('../../../../../../apps/chord/renderer/rendering/chord-stage', () => ({ ChordStage: () => null }));
vi.mock('@mediabunny/aac-encoder', () => ({ registerAacEncoder: vi.fn() }));
vi.mock('@mediabunny/mp3-encoder', () => ({ registerMp3Encoder: vi.fn() }));
vi.mock('mediabunny', () => {
  class Format {}
  return {
    ALL_FORMATS: [], BlobSource: class {}, UrlSource: class {},
    Input: class { getPrimaryVideoTrack = fake.primaryTrack; getPrimaryAudioTrack = fake.primaryTrack; dispose = fake.dispose; },
    Output: class { cancel = fake.cancel; finalize = fake.finalize; start = vi.fn(async () => {}); addVideoTrack() {} addAudioTrack() {} },
    CanvasSource: class { add = fake.add; close = fake.videoClose; },
    AudioBufferSource: class { add = fake.audioAdd; close = fake.audioClose; },
    AudioBufferSink: class { buffers = fake.buffers; }, VideoSampleSink: class { samples = fake.samples; },
    Conversion: { init: fake.conversion }, ConversionCanceledError: class extends Error {},
    StreamTarget: class {}, MkvOutputFormat: Format, MovOutputFormat: Format,
    Mp3OutputFormat: Format, Mp4OutputFormat: Format, WavOutputFormat: Format, WebMOutputFormat: Format,
    canEncodeAudio: vi.fn(async () => true), canEncodeVideo: vi.fn(async () => true),
  };
});

import { runExport } from '../../../../../../apps/chord/renderer/features/export/export-engine';

const video = { kind: 'video', width: 320, height: 180, fps: 30, container: 'mp4', videoCodec: 'avc', audioCodec: 'aac', includeAudio: false, quality: 'medium' } as const;
const image = { kind: 'image', timeMs: 500 } as const;
const audio = { kind: 'audio', format: 'wav', quality: 'medium' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  fake.add.mockReset().mockResolvedValue(undefined);
  fake.audioAdd.mockReset().mockResolvedValue(undefined);
  fake.videoClose.mockReset().mockResolvedValue(undefined);
  fake.audioClose.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['synthetic']) })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {}, clearRect() {} } as unknown as CanvasRenderingContext2D);
  fake.primaryTrack.mockResolvedValue({ computeDuration: async () => 2, getDisplayWidth: async () => 1920, getDisplayHeight: async () => 1080, getTimeResolution: async () => 1000 });
  fake.samples.mockImplementation(async function* () {});
  fake.buffers.mockImplementation(async function* () {});
});

describe('timestamp-interleaved export admission and awaited public EOF', () => {
  function request(audioBuffers = 50) {
    fake.buffers.mockImplementation(async function* () {
      for (let i = 0; i < audioBuffers; i++) yield { buffer: { duration: 0.02 }, timestamp: i * 0.02, duration: 0.02 };
    });
    return input({ ...video, includeAudio: true });
  }

  it('feeds contiguous audio near each video timestamp and preserves all buffers', async () => {
    const events: string[] = [];
    let videoTime = 0, audioTime = 0, peakLead = 0;
    fake.add.mockImplementation(async (time?: number) => { videoTime = time!; events.push('video'); });
    fake.audioAdd.mockImplementation(async (buffer?: { duration: number }) => {
      audioTime += buffer!.duration;
      peakLead = Math.max(peakLead, audioTime - videoTime);
      events.push('audio');
    });
    await runExport(request());
    expect(events.indexOf('audio')).toBeLessThan(events.lastIndexOf('video'));
    expect(fake.add).toHaveBeenCalledTimes(30);
    expect(fake.audioAdd).toHaveBeenCalledTimes(50);
    expect(peakLead).toBeLessThanOrEqual(1 / 30 + 0.02 + 1e-9);
    expect(fake.videoClose).toHaveBeenCalledTimes(1);
    expect(fake.audioClose).toHaveBeenCalledTimes(1);
  });

  it('closes exhausted audio before admitting the remaining video tail', async () => {
    const events: string[] = [];
    fake.add.mockImplementation(async () => { events.push('video'); });
    fake.audioClose.mockImplementation(async () => { events.push('audio-close'); });
    await runExport(request(5));
    expect(fake.audioAdd).toHaveBeenCalledTimes(5);
    expect(events.indexOf('audio-close')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('audio-close')).toBeLessThan(events.lastIndexOf('video'));
  });

  it('closes video before draining audio longer than the declared project duration', async () => {
    const events: string[] = [];
    fake.audioAdd.mockImplementation(async () => { events.push('audio'); });
    fake.videoClose.mockImplementation(async () => { events.push('video-close'); });
    await runExport(request(70));
    expect(fake.audioAdd).toHaveBeenCalledTimes(70);
    expect(events.indexOf('video-close')).toBeLessThan(events.lastIndexOf('audio'));
  });

  it('awaits EOF before finalizing the output', async () => {
    let release!: () => void;
    fake.videoClose.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const running = runExport(input(video));
    await vi.waitFor(() => expect(fake.videoClose).toHaveBeenCalledTimes(1));
    expect(fake.finalize).not.toHaveBeenCalled();
    release();
    await running;
    expect(fake.finalize).toHaveBeenCalledTimes(1);
  });

  it.each(['video', 'audio'] as const)('observes %s EOF rejection and cancels without finalizing', async (track) => {
    if (track === 'video') fake.videoClose.mockRejectedValue(new Error('video EOF failed'));
    else fake.audioClose.mockRejectedValue(new Error('audio EOF failed'));
    await expect(runExport(track === 'video' ? input(video) : request(5))).rejects.toThrow(`${track} EOF failed`);
    expect(fake.cancel).toHaveBeenCalledTimes(1);
    expect(fake.finalize).not.toHaveBeenCalled();
    expect(fake.unmount).toHaveBeenCalledTimes(1);
  });

  it('does not admit later producer EOF or finalization after cancellation during audio EOF', async () => {
    let release!: () => void;
    fake.audioClose.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const running = runExport({ ...request(5), signal: controller.signal });
    await vi.waitFor(() => expect(fake.audioClose).toHaveBeenCalledTimes(1));
    controller.abort();
    release();
    await expect(running).rejects.toThrow();
    expect(fake.videoClose).not.toHaveBeenCalled();
    expect(fake.finalize).not.toHaveBeenCalled();
    expect(fake.cancel).toHaveBeenCalledTimes(1);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function input(settings: ExportSettings) {
  return {
    project: createTestProject({
      audio: { name: 'Synthetic', path: '/synthetic.wav', durationMs: 1000 },
      background: { kind: 'video', media: { path: '/synthetic.mp4', name: 'Synthetic', durationMs: 2000 }, loop: true, fit: 'cover', dim: 0, blur: 0 },
    }),
    settings, audioUrl: '/audio', backgroundUrl: '/background',
    sink: { write: vi.fn(async () => {}) }, onProgress: vi.fn(), signal: new AbortController().signal,
  };
}

describe('export resource ownership', () => {
  it('cleans the renderer and output when background preparation rejects', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('preparation failed'));
    const request = input(video);
    request.project.background = { kind: 'image', media: { path: '/synthetic.png', name: 'Synthetic', durationMs: null }, loop: false, fit: 'cover', dim: 0, blur: 0 };
    await expect(runExport(request)).rejects.toThrow('preparation failed');
    expect(fake.unmount).toHaveBeenCalledTimes(1);
    expect(document.body.childElementCount).toBe(0);
    expect(fake.cancel).toHaveBeenCalledTimes(1);
  });

  it('disposes a media input when background metadata preparation rejects', async () => {
    fake.primaryTrack.mockRejectedValue(new Error('metadata failed'));
    await expect(runExport(input(image))).rejects.toThrow('metadata failed');
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(document.body.childElementCount).toBe(0);
  });

  it('cleans audio input and output when conversion initialization rejects', async () => {
    fake.conversion.mockRejectedValue(new Error('conversion failed'));
    await expect(runExport(input(audio))).rejects.toThrow('conversion failed');
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(fake.cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps background canvas retention independent of clip frame count', async () => {
    const create = vi.spyOn(document, 'createElement');
    fake.samples.mockImplementation(async function* () {
      for (let index = 0; index < 60; index++) yield {
        timestamp: index / 30, displayWidth: 1920, displayHeight: 1080,
        draw() {}, close() {},
      };
    });
    await runExport(input(video));
    // Two alternating background surfaces preserve React/Konva cache updates.
    // The synthetic renderer creates one output surface per render invocation.
    const canvases = create.mock.calls.filter(([tag]) => String(tag) === 'canvas').length;
    expect(canvases - fake.add.mock.calls.length).toBeLessThanOrEqual(2);
    expect(fake.add).toHaveBeenCalledTimes(30);
  });

  it('keeps consumer surfaces alive until the renderer unmounts after a held add', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    fake.add.mockImplementationOnce(() => held);
    fake.samples.mockImplementation(async function* () {
      for (const timestamp of [0, 1]) yield { timestamp, displayWidth: 64, displayHeight: 36, draw() {}, close() {} };
    });
    const create = vi.spyOn(document, 'createElement');
    const controller = new AbortController();
    const running = runExport({ ...input(video), signal: controller.signal });
    await vi.waitFor(() => expect(fake.add).toHaveBeenCalledTimes(1));
    const surface = create.mock.results.find((result) => result.value instanceof HTMLCanvasElement)!.value as HTMLCanvasElement;
    fake.unmount.mockImplementationOnce(() => { expect([surface.width, surface.height]).toEqual([64, 36]); });
    controller.abort();
    try {
      expect([surface.width, surface.height]).toEqual([64, 36]);
      expect(fake.unmount).not.toHaveBeenCalled();
    } finally {
      release();
      await expect(running).rejects.toThrow();
    }
    expect(fake.unmount).toHaveBeenCalledTimes(1);
    expect([surface.width, surface.height]).toEqual([0, 0]);
  });

  it('does not admit a PNG write after cancellation during byte preparation', async () => {
    let release!: (bytes: ArrayBuffer) => void;
    const bytes = new Promise<ArrayBuffer>((resolve) => { release = resolve; });
    const read = vi.fn(() => bytes);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback({ arrayBuffer: read } as unknown as Blob));
    const controller = new AbortController();
    const request = { ...input(image), signal: controller.signal };
    request.project.background = { kind: 'color', color: '#000000' };
    const running = runExport(request);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    controller.abort();
    release(new ArrayBuffer(4));
    await expect(running).rejects.toThrow();
    expect(request.sink.write).not.toHaveBeenCalled();
    expect(fake.unmount).toHaveBeenCalledTimes(1);
  });
});
