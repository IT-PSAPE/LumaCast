import { afterEach, describe, expect, it, vi } from 'vitest';
import { GpuFrameRefresh } from '../../../../../apps/cast/main/ndi/gpu-frame-refresh';
afterEach(() => vi.useRealTimers());
describe('shared texture refresh', () => {
  it('retries a missed static capture and stops after matching native acceptance', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const timeout = vi.fn();
    const refresh = new GpuFrameRefresh(capture, timeout);
    refresh.request(); vi.advanceTimersByTime(250); expect(capture).toHaveBeenCalledTimes(2);
    refresh.accept(refresh.id); vi.advanceTimersByTime(5000);
    expect(capture).toHaveBeenCalledTimes(2); expect(timeout).not.toHaveBeenCalled();
  });
  it('keeps refreshing when an obsolete submission completes', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const refresh = new GpuFrameRefresh(capture, vi.fn());
    refresh.request(); const previous = refresh.id; refresh.request(); refresh.accept(previous);
    vi.advanceTimersByTime(250); expect(capture).toHaveBeenCalledTimes(3);
    refresh.stop(); vi.advanceTimersByTime(5000); expect(capture).toHaveBeenCalledTimes(3);
    refresh.request(); expect(capture).toHaveBeenCalledTimes(3);
  });
  it('reports unavailable static capture after five seconds without retrying indefinitely', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const timeout = vi.fn();
    const refresh = new GpuFrameRefresh(capture, timeout); refresh.request();
    vi.advanceTimersByTime(10000); expect(capture).toHaveBeenCalledTimes(20); expect(timeout).toHaveBeenCalledOnce();
  });
});
