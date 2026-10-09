import { afterEach, describe, expect, it, vi } from 'vitest';
import { GpuFrameRefresh } from '../../../../../apps/cast/main/ndi/gpu-frame-refresh';
afterEach(() => vi.useRealTimers());
describe('shared texture refresh', () => {
  it('coalesces repeated same-key requests without extending the five-second retry window', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const timeout = vi.fn();
    const refresh = new GpuFrameRefresh(capture, timeout);
    refresh.request('take'); const id = refresh.id;
    for (let index = 0; index < 50; index += 1) {
      vi.advanceTimersByTime(100);
      refresh.request('take');
    }
    expect(refresh.id).toBe(id);
    expect(capture).toHaveBeenCalledTimes(20);
    expect(timeout).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    refresh.request('take');
    expect(capture).toHaveBeenCalledTimes(20);
    expect(timeout).toHaveBeenCalledOnce();
  });
  it('stops retries on matching acceptance and does not restart an accepted key', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const refresh = new GpuFrameRefresh(capture, vi.fn());
    refresh.request('scene'); const id = refresh.id;
    vi.advanceTimersByTime(250); expect(capture).toHaveBeenCalledTimes(2);
    refresh.accept(id); vi.advanceTimersByTime(5000);
    refresh.request('scene');
    expect(capture).toHaveBeenCalledTimes(2);
    expect(refresh.id).toBe(id);
  });
  it('accepts a slow submission despite repeated updates for the same key', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const timeout = vi.fn();
    const refresh = new GpuFrameRefresh(capture, timeout);
    refresh.request('take'); const id = refresh.id;
    for (let update = 0; update < 5; update += 1) {
      vi.advanceTimersByTime(100);
      refresh.request('take');
    }
    refresh.accept(id);
    const captures = capture.mock.calls.length;
    vi.advanceTimersByTime(5000);
    expect(capture).toHaveBeenCalledTimes(captures);
    expect(timeout).not.toHaveBeenCalled();
  });
  it('stops pending retries and ignores all requests after shutdown', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const timeout = vi.fn();
    const refresh = new GpuFrameRefresh(capture, timeout);
    refresh.request('scene'); refresh.stop();
    vi.advanceTimersByTime(5000);
    refresh.request('next'); refresh.request();
    expect(capture).toHaveBeenCalledOnce();
    expect(timeout).not.toHaveBeenCalled();
  });
  it('supersedes a key for a new key or an unkeyed invalidation', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const refresh = new GpuFrameRefresh(capture, vi.fn());
    refresh.request('scene-a'); const first = refresh.id;
    refresh.request('scene-b'); const second = refresh.id;
    expect(second).toBeGreaterThan(first);
    refresh.request(); const invalidated = refresh.id;
    expect(invalidated).toBeGreaterThan(second);
    refresh.request('scene-a');
    expect(refresh.id).toBeGreaterThan(invalidated);
    expect(capture).toHaveBeenCalledTimes(4);
  });
  it('forces a fresh request while attaching subsequent clock updates to its identity', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const timeout = vi.fn();
    const refresh = new GpuFrameRefresh(capture, timeout);
    refresh.request('scene'); refresh.accept(refresh.id);
    refresh.request('scene', true); const forcedId = refresh.id;
    for (let update = 0; update < 50; update += 1) {
      vi.advanceTimersByTime(100);
      refresh.request('scene');
    }
    expect(refresh.id).toBe(forcedId);
    expect(capture).toHaveBeenCalledTimes(21);
    expect(timeout).toHaveBeenCalledOnce();
  });
  it('does not let an obsolete completion cancel retries for a newer key', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const refresh = new GpuFrameRefresh(capture, vi.fn());
    refresh.request('old'); const oldId = refresh.id;
    refresh.request('new'); const newId = refresh.id;
    refresh.accept(oldId); vi.advanceTimersByTime(250);
    expect(refresh.id).toBe(newId);
    expect(capture).toHaveBeenCalledTimes(3);
  });
  it('does not restart a timed-out key, but a new key receives its own bounded retry window', () => {
    vi.useFakeTimers(); const capture = vi.fn(); const timeout = vi.fn();
    const refresh = new GpuFrameRefresh(capture, timeout);
    refresh.request('old'); const oldId = refresh.id;
    vi.advanceTimersByTime(5000);
    expect(capture).toHaveBeenCalledTimes(20); expect(timeout).toHaveBeenCalledOnce();
    refresh.request('old'); expect(refresh.id).toBe(oldId);
    refresh.request('new'); expect(refresh.id).toBeGreaterThan(oldId);
    expect(capture).toHaveBeenCalledTimes(21);
    vi.advanceTimersByTime(5000);
    expect(capture).toHaveBeenCalledTimes(40); expect(timeout).toHaveBeenCalledTimes(2);
  });
});
