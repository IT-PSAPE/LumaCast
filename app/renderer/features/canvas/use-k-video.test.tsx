import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLayerVideoElement, useKVideo } from './use-k-video';

describe('useKVideo', () => {
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName !== 'video') return element;
      const video = element as HTMLVideoElement;

      Object.defineProperty(video, 'readyState', {
        configurable: true,
        get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
      });
      Object.defineProperty(video, 'duration', {
        configurable: true,
        writable: true,
        value: 120,
      });
      Object.defineProperty(video, 'paused', {
        configurable: true,
        writable: true,
        value: true,
      });
      Object.defineProperty(video, 'ended', {
        configurable: true,
        writable: true,
        value: false,
      });
      video.load = vi.fn();
      video.play = vi.fn().mockImplementation(async () => {
        Object.defineProperty(video, 'paused', { configurable: true, writable: true, value: false });
      });
      video.pause = vi.fn().mockImplementation(() => {
        Object.defineProperty(video, 'paused', { configurable: true, writable: true, value: true });
      });
      return video;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses the same pooled video element across mute changes', () => {
    const { rerender, unmount } = renderHook(
      ({ muted }) => useKVideo('/video.mp4', { autoplay: true, loop: true, muted, playbackRate: 1 }),
      { initialProps: { muted: false } },
    );

    const beforeMute = getLayerVideoElement('/video.mp4');

    expect(beforeMute).not.toBeNull();
    if (!beforeMute) throw new Error('Expected pooled video element');

    act(() => {
      beforeMute.currentTime = 42;
    });

    rerender({ muted: true });

    const afterMute = getLayerVideoElement('/video.mp4');

    expect(afterMute).toBe(beforeMute);
    expect(afterMute?.currentTime).toBe(42);
    expect(afterMute?.muted).toBe(true);

    unmount();
    expect(getLayerVideoElement('/video.mp4')).toBeNull();
  });

  it('keeps the same pooled video element when loop or playbackRate change', () => {
    const { rerender, unmount } = renderHook(
      ({ loop, playbackRate }) => useKVideo('/video.mp4', { autoplay: false, loop, muted: true, playbackRate }),
      { initialProps: { loop: false, playbackRate: 1 } },
    );

    const initial = getLayerVideoElement('/video.mp4');
    expect(initial).not.toBeNull();
    if (!initial) throw new Error('Expected pooled video element');

    act(() => {
      initial.currentTime = 17;
    });

    rerender({ loop: true, playbackRate: 1.5 });

    const afterChange = getLayerVideoElement('/video.mp4');
    expect(afterChange).toBe(initial);
    expect(afterChange?.currentTime).toBe(17);
    expect(afterChange?.loop).toBe(true);
    expect(afterChange?.playbackRate).toBe(1.5);

    unmount();
    expect(getLayerVideoElement('/video.mp4')).toBeNull();
  });
});
