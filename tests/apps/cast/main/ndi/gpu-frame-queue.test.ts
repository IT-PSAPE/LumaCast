import { describe, expect, it, vi } from 'vitest';
import { GpuFrameQueue, isFullGpuFrame } from '../../../../../apps/cast/main/ndi/gpu-frame-queue';

function deferred() {
  let resolve!: (result: { conversionDurationMs: number; sendDurationMs: number; frameBytes: number }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ conversionDurationMs: number; sendDurationMs: number; frameBytes: number }>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const result = { conversionDurationMs: 2, sendDurationMs: 1, frameBytes: 4 };

describe('GPU frame ownership', () => {
  it('keeps only the newest waiting frame and releases each lease after native completion', async () => {
    const first = deferred();
    const submit = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(result);
    const queue = new GpuFrameQueue(submit);
    const frames = Array.from({ length: 3 }, () => ({ release: vi.fn() }));
    frames.forEach((frame) => queue.offer(frame));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(frames[0].release).not.toHaveBeenCalled();
    expect(frames[1].release).toHaveBeenCalledTimes(1);
    first.resolve(result);
    await queue.flush();
    expect(submit).toHaveBeenNthCalledWith(2, frames[2]);
    frames.forEach((frame) => expect(frame.release).toHaveBeenCalledTimes(1));
    expect(queue.report()).toMatchObject({ received: 3, sent: 2, replaced: 1, failed: 0 });
  });

  it('releases failed frames and continues with the latest frame', async () => {
    const first = deferred();
    const submit = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(result);
    const queue = new GpuFrameQueue(submit);
    const frames = [{ release: vi.fn() }, { release: vi.fn() }];
    frames.forEach((frame) => queue.offer(frame));
    first.reject(new Error('native send failed'));
    await queue.flush();
    frames.forEach((frame) => expect(frame.release).toHaveBeenCalledTimes(1));
    expect(queue.report()).toMatchObject({ failed: 1, sent: 1, lastError: 'native send failed' });
  });

  it('discards waiting frames on shutdown but retains the active texture until native work finishes', async () => {
    const first = deferred();
    const queue = new GpuFrameQueue(() => first.promise);
    const active = { release: vi.fn() };
    const waiting = { release: vi.fn() };
    queue.offer(active);
    queue.offer(waiting);
    const stopped = queue.stop();
    expect(waiting.release).toHaveBeenCalledTimes(1);
    expect(active.release).not.toHaveBeenCalled();
    first.resolve(result);
    await stopped;
    expect(active.release).toHaveBeenCalledTimes(1);
    const late = { release: vi.fn() };
    queue.offer(late);
    expect(late.release).toHaveBeenCalledTimes(1);
  });

  it('omits warmup frames from latency samples', async () => {
    const queue = new GpuFrameQueue(async () => result, 1);
    queue.offer({ release: vi.fn() });
    await queue.flush();
    expect(queue.report()).toMatchObject({ sent: 1, measuredFrames: 0 });
    queue.offer({ release: vi.fn() });
    await queue.flush();
    expect(queue.report()).toMatchObject({ sent: 2, measuredFrames: 1, conversionP95Ms: 2 });
  });
});

describe('GPU texture metadata', () => {
  const info = {
    widgetType: 'frame', pixelFormat: 'bgra', codedSize: { width: 1920, height: 1080 },
    visibleRect: { x: 0, y: 0, width: 1920, height: 1080 },
    sharedTextureHandle: Buffer.alloc(8),
  };
  it('accepts full-size BGRA and RGBA textures', () => {
    expect(isFullGpuFrame(info)).toBe(true);
    expect(isFullGpuFrame({ ...info, pixelFormat: 'rgba' })).toBe(true);
  });
  it('rejects cropped, popup, undersized, or unsupported textures', () => {
    expect(isFullGpuFrame({ ...info, widgetType: 'popup' })).toBe(false);
    expect(isFullGpuFrame({ ...info, pixelFormat: 'nv12' })).toBe(false);
    expect(isFullGpuFrame({ ...info, sharedTextureHandle: Buffer.alloc(4) })).toBe(false);
    expect(isFullGpuFrame({ ...info, codedSize: { width: 960, height: 540 } })).toBe(false);
    expect(isFullGpuFrame({ ...info, visibleRect: { ...info.visibleRect, x: 1 } })).toBe(false);
  });
});
