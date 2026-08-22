import { describe, expect, it, vi } from 'vitest';
import { createEventLoopLagSampler } from './system-metrics';

describe('event loop lag sampler', () => {
  it('starts lazily and reports only sampled lag from the rolling window', () => {
    let nowNs = 0n;
    let scheduled: (() => void) | undefined;
    const unref = vi.fn();
    const setTimeoutSpy = vi.fn((callback: () => void) => {
      scheduled = callback;
      return { unref } as unknown as NodeJS.Timeout;
    });

    const sampler = createEventLoopLagSampler({
      nowNs: () => nowNs,
      setTimeout: setTimeoutSpy,
      clearTimeout: vi.fn(),
    });

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(sampler.snapshot()).toEqual({ lastMs: 0, p95Ms: 0, maxMs: 0, count: 0 });

    sampler.ensureStarted();
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);

    nowNs = 255_000_000n;
    if (!scheduled) throw new Error('expected sampler to schedule a callback');
    scheduled();
    expect(sampler.snapshot()).toEqual({ lastMs: 5, p95Ms: 5, maxMs: 5, count: 1 });

    nowNs = 515_000_000n;
    if (!scheduled) throw new Error('expected sampler to reschedule a callback');
    scheduled();
    expect(sampler.snapshot()).toEqual({ lastMs: 10, p95Ms: 10, maxMs: 10, count: 2 });
  });
});
