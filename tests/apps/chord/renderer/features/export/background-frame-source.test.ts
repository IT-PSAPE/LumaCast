import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestProject } from '../../test-store';

const fake = vi.hoisted(() => ({ primary: vi.fn(), dispose: vi.fn(), source: vi.fn(), samples: vi.fn() }));
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  Input: class { getPrimaryVideoTrack = fake.primary; dispose = fake.dispose; },
  UrlSource: class { constructor(...args: unknown[]) { fake.source(...args); } },
  VideoSampleSink: class { samples = fake.samples; },
}));

import { prepareBackgroundFrameSource } from '../../../../../../apps/chord/renderer/features/export/background-frame-source';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function project(loop = false) {
  return createTestProject({ background: {
    kind: 'video', media: { path: '/synthetic.mp4', name: 'Synthetic', durationMs: 10000 },
    loop, fit: 'cover', dim: 0, blur: 0,
  } });
}

let live = 0;
let peak = 0;
let draws: number[] = [];
function sample(timestamp: number) {
  live++;
  peak = Math.max(peak, live);
  let closed = false;
  return {
    timestamp, displayWidth: 640, displayHeight: 360,
    draw() { draws.push(timestamp); },
    close() { if (!closed) { closed = true; live--; } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.dispose.mockReset();
  fake.primary.mockResolvedValue({ computeDuration: async () => 10, getDisplayWidth: async () => 640, getDisplayHeight: async () => 360, getTimeResolution: async () => 1000 });
  fake.samples.mockImplementation(async function* () { for (let i = 0; i < 300; i++) yield sample(i / 30); });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect() {} } as unknown as CanvasRenderingContext2D);
  live = 0; peak = 0; draws = [];
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('bounded export background decoding', () => {
  it('retains two samples and two alternating surfaces across repeated video loops', async () => {
    const source = await prepareBackgroundFrameSource(project(true), '/clip', new AbortController().signal);
    const canvases = new Set<HTMLCanvasElement>();
    let previous: CanvasImageSource | null = null;
    try {
      for (let i = 0; i < 1000; i++) {
        const frame = await source.getFrame(i / 30);
        expect(frame).not.toBe(previous);
        previous = frame;
        canvases.add(frame as HTMLCanvasElement);
      }
      expect(canvases.size).toBe(2);
      expect(peak).toBeLessThanOrEqual(2);
      expect(fake.samples).toHaveBeenCalledTimes(4);
      expect(draws).toHaveLength(1000);
    } finally { await source.dispose(); }
    expect(live).toBe(0);
    for (const canvas of canvases) expect([canvas.width, canvas.height]).toEqual([0, 0]);
    const options = fake.source.mock.calls[0][1];
    expect(options.maxCacheSize).toBe(8 * 1024 * 1024);
    expect(options.getRetryDelay()).toBeNull();
  });

  it.each([false, true])('preserves floor selection, first/last hold and backward access (loop: %s)', async (loop) => {
    fake.primary.mockResolvedValue({ computeDuration: async () => 1.5, getDisplayWidth: async () => 640, getDisplayHeight: async () => 360, getTimeResolution: async () => 1000 });
    fake.samples.mockImplementation(async function* () { for (const time of [0.1, 0.5, 1]) yield sample(time); });
    const source = await prepareBackgroundFrameSource(project(loop), '/clip', new AbortController().signal);
    try {
      for (const time of [0, 0.49, 0.5, 1.49, 2, 0.5]) await source.getFrame(time);
      expect(draws).toEqual([0.1, 0.1, 0.5, 1, loop ? 0.5 : 1, 0.5]);
    } finally { await source.dispose(); }
    expect(live).toBe(0);
  });

  it('preserves exact frame-grid boundaries through multiplication/modulo roundoff', async () => {
    fake.primary.mockResolvedValue({ computeDuration: async () => 3, getDisplayWidth: async () => 640, getDisplayHeight: async () => 360, getTimeResolution: async () => 1000 });
    fake.samples.mockImplementation(async function* () { for (const time of [0, 0.3, 0.7, 2.9]) yield sample(time); });
    const source = await prepareBackgroundFrameSource(project(true), '/clip', new AbortController().signal);
    try {
      await source.getFrame(99 * (1 / 30));
      await source.getFrame(111 * (1 / 30));
      await source.getFrame(0.7 - 1e-9);
      await source.getFrame(3 - 1e-9);
      await source.getFrame(3);
      expect(draws).toEqual([0.3, 0.7, 0.3, 2.9, 0]);
    } finally { await source.dispose(); }
    expect(live).toBe(0);
  });

  it('normalizes a rounded loop boundary without snapping genuine earlier times', async () => {
    fake.primary.mockResolvedValue({ computeDuration: async () => 0.3, getDisplayWidth: async () => 640, getDisplayHeight: async () => 360, getTimeResolution: async () => 1000 });
    fake.samples.mockImplementation(async function* () { for (const time of [0, 0.1, 0.2]) yield sample(time); });
    const source = await prepareBackgroundFrameSource(project(true), '/clip', new AbortController().signal);
    try {
      await source.getFrame(99 * (1 / 30));
      await source.getFrame(99 * (1 / 30) - 1e-9);
      expect(draws).toEqual([0, 0.2]);
    } finally { await source.dispose(); }
    expect(live).toBe(0);
  });

  it('preserves floor selection for representable tiny cycles', async () => {
    fake.primary.mockResolvedValue({ computeDuration: async () => 1e-16, getDisplayWidth: async () => 640, getDisplayHeight: async () => 360, getTimeResolution: async () => 1e18 });
    fake.samples.mockImplementation(async function* () { for (const time of [0, 5e-17, 7.5e-17]) yield sample(time); });
    const source = await prepareBackgroundFrameSource(project(true), '/clip', new AbortController().signal);
    try {
      await source.getFrame(2.5e-17);
      await source.getFrame(6e-17);
      expect(draws).toEqual([0, 5e-17]);
    } finally { await source.dispose(); }
  });

  it('supports long resolvable clocks and rejects numerically ambiguous requests', async () => {
    fake.primary.mockResolvedValue({ computeDuration: async () => 1, getDisplayWidth: async () => 640, getDisplayHeight: async () => 360, getTimeResolution: async () => 1000 });
    fake.samples.mockImplementation(async function* () { for (const time of [0, 0.25, 0.5, 0.75]) yield sample(time); });
    const source = await prepareBackgroundFrameSource(project(true), '/clip', new AbortController().signal);
    try {
      await source.getFrame(1e6 + 0.5);
      await source.getFrame(1e6 + 0.5 - 1e-6);
      expect(draws).toEqual([0.5, 0.25]);
      await expect(source.getFrame(1e20)).rejects.toThrow('cannot be resolved');
      await expect(source.getFrame(Infinity)).rejects.toThrow('must be finite');
      await expect(source.getFrame(NaN)).rejects.toThrow('must be finite');
    } finally { await source.dispose(); }
    expect(live).toBe(0);
  });

  it.each([-1, NaN, Infinity])('rejects invalid duration %s before decoding/modulo', async (duration) => {
    fake.primary.mockResolvedValue({ computeDuration: async () => duration, getDisplayWidth: async () => 640, getDisplayHeight: async () => 360, getTimeResolution: async () => 1000 });
    await expect(prepareBackgroundFrameSource(project(true), '/clip', new AbortController().signal)).rejects.toThrow('invalid duration');
    expect(fake.samples).not.toHaveBeenCalled();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps zero-duration video as no background', async () => {
    fake.primary.mockResolvedValue({ computeDuration: async () => 0, getDisplayWidth: async () => 0, getDisplayHeight: async () => 0, getTimeResolution: async () => 1000 });
    const source = await prepareBackgroundFrameSource(project(true), '/clip', new AbortController().signal);
    expect(await source.getFrame(0)).toBeNull();
    await source.dispose();
    expect(fake.samples).not.toHaveBeenCalled();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([0, NaN, Infinity])('rejects invalid source timebase %s', async (timeResolution) => {
    fake.primary.mockResolvedValue({ computeDuration: async () => 3, getDisplayWidth: async () => 640, getDisplayHeight: async () => 360, getTimeResolution: async () => timeResolution });
    await expect(prepareBackgroundFrameSource(project(true), '/clip', new AbortController().signal)).rejects.toThrow('invalid timebase');
    expect(fake.samples).not.toHaveBeenCalled();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });

  it('releases current and lookahead samples after decoder failure', async () => {
    fake.samples.mockImplementation(async function* () { yield sample(0); yield sample(1); throw new Error('decode failed'); });
    const source = await prepareBackgroundFrameSource(project(), '/clip', new AbortController().signal);
    try {
      await source.getFrame(0);
      await expect(source.getFrame(1)).rejects.toThrow('decode failed');
    } finally { await source.dispose(); }
    expect(live).toBe(0);
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });

  it('interrupts pending metadata via input disposal on abort', async () => {
    const metadata = deferred<never>();
    fake.primary.mockImplementation(() => metadata.promise);
    fake.dispose.mockImplementation(() => metadata.reject(new Error('input disposed')));
    const controller = new AbortController();
    const preparing = prepareBackgroundFrameSource(project(), '/clip', controller.signal);
    controller.abort();
    await expect(preparing).rejects.toThrow('input disposed');
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes input before awaiting an iterator blocked in next()', async () => {
    const next = deferred<never>();
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    let requested = 0;
    fake.samples.mockImplementation(() => ({
      next: () => requested++ === 0 ? Promise.resolve({ done: false, value: sample(0) }) : next.promise,
      return: returned,
    }));
    fake.dispose.mockImplementation(() => next.reject(new Error('input disposed')));
    const controller = new AbortController();
    const source = await prepareBackgroundFrameSource(project(), '/clip', controller.signal);
    const reading = source.getFrame(0);
    await vi.waitFor(() => expect(requested).toBe(2));
    controller.abort();
    await expect(reading).rejects.toThrow('input disposed');
    await source.dispose();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(returned).toHaveBeenCalledTimes(1);
    expect(live).toBe(0);
  });

  it('rejects oversized frame surfaces before decoding', async () => {
    fake.primary.mockResolvedValue({ computeDuration: async () => 10, getDisplayWidth: async () => 10000, getDisplayHeight: async () => 10000, getTimeResolution: async () => 1000 });
    await expect(prepareBackgroundFrameSource(project(), '/clip', new AbortController().signal)).rejects.toThrow('128 MiB');
    expect(fake.samples).not.toHaveBeenCalled();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
  });

  it('closes a bitmap that resolves after cancellation', async () => {
    const bitmap = { close: vi.fn() };
    const decoded = deferred<typeof bitmap>();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob() })));
    vi.stubGlobal('createImageBitmap', vi.fn(() => decoded.promise));
    const image = project();
    image.background = { ...image.background, kind: 'image' } as typeof image.background;
    const controller = new AbortController();
    const preparing = prepareBackgroundFrameSource(image, '/image', controller.signal);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(1));
    controller.abort();
    decoded.resolve(bitmap);
    await expect(preparing).rejects.toThrow();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/image', { signal: controller.signal });
  });
});
