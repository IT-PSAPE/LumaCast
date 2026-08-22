import { cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetVideoPoolForTests,
  getLayerVideoElement,
  getVideoPoolStats,
  retainVideoSource,
  useKVideo,
  warmVideoClaim,
  warmVideoSource,
} from './use-k-video';

describe('video pool residency', () => {
  const originalLoad = HTMLMediaElement.prototype.load;
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalPause = HTMLMediaElement.prototype.pause;
  const pausedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'paused');
  const readyStateDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
  const endedDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'ended');
  const currentTimeDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');

  beforeEach(() => {
    __resetVideoPoolForTests();
    HTMLMediaElement.prototype.load = vi.fn();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() {
        return this.dataset.paused !== '0';
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
      configurable: true,
      get() {
        return HTMLMediaElement.HAVE_CURRENT_DATA;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'ended', {
      configurable: true,
      get() {
        return false;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() {
        return Number(this.dataset.currentTime ?? '0');
      },
      set(value: number) {
        this.dataset.currentTime = String(value);
      },
    });
    HTMLMediaElement.prototype.play = vi.fn(async function play(this: HTMLMediaElement) {
      this.dataset.paused = '0';
    }) as typeof HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.pause = vi.fn(function pause(this: HTMLMediaElement) {
      this.dataset.paused = '1';
    }) as typeof HTMLMediaElement.prototype.pause;
  });

  afterEach(() => {
    cleanup();
    __resetVideoPoolForTests();
    HTMLMediaElement.prototype.load = originalLoad;
    HTMLMediaElement.prototype.play = originalPlay;
    HTMLMediaElement.prototype.pause = originalPause;
    if (pausedDescriptor) Object.defineProperty(HTMLMediaElement.prototype, 'paused', pausedDescriptor);
    if (readyStateDescriptor) Object.defineProperty(HTMLMediaElement.prototype, 'readyState', readyStateDescriptor);
    if (endedDescriptor) Object.defineProperty(HTMLMediaElement.prototype, 'ended', endedDescriptor);
    if (currentTimeDescriptor) Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', currentTimeDescriptor);
  });

  it('adopts a prewarmed shared-layer video without exposing it to painters before retain', () => {
    const warm = warmVideoSource('asset://video.mp4');

    expect(getLayerVideoElement('asset://video.mp4')).toBeNull();
    expect(getVideoPoolStats()).toMatchObject({
      warmIssuedCount: 1,
      warmResidentCount: 1,
      warmHitCount: 0,
    });

    const retain = retainVideoSource('asset://video.mp4', {
      autoplay: false,
      loop: true,
      muted: true,
      playbackRate: 1,
    });

    const adopted = getLayerVideoElement('asset://video.mp4');
    expect(adopted).not.toBeNull();
    expect(getVideoPoolStats()).toMatchObject({
      warmHitCount: 1,
    });

    warm.release();
    retain.release();

    expect(getLayerVideoElement('asset://video.mp4')).toBeNull();

    const retainAgain = retainVideoSource('asset://video.mp4', {
      autoplay: false,
      loop: true,
      muted: true,
      playbackRate: 1,
    });
    expect(getLayerVideoElement('asset://video.mp4')).toBe(adopted);
    retainAgain.release();
  });

  it('seeks a retired shared-layer video back to zero before re-adoption', () => {
    const retain = retainVideoSource('asset://reset.mp4', {
      autoplay: true,
      loop: true,
      muted: true,
      playbackRate: 1,
    });
    const video = getLayerVideoElement('asset://reset.mp4');
    expect(video).not.toBeNull();
    if (video) {
      video.currentTime = 42;
    }
    retain.release();

    const nextRetain = retainVideoSource('asset://reset.mp4', {
      autoplay: false,
      loop: true,
      muted: true,
      playbackRate: 1,
    });
    expect(getLayerVideoElement('asset://reset.mp4')?.currentTime).toBe(0);
    nextRetain.release();
  });

  it('consumes a dedicated warm claim exactly once and serves the warmed element on first hook paint', () => {
    const warm = warmVideoClaim('show:node:video-1', 'asset://clip.mp4');

    const first = renderHook(() => useKVideo('asset://clip.mp4', {
      autoplay: false,
      loop: false,
      muted: true,
      playbackRate: 1,
    }, false, 'show:node:video-1'));

    expect(first.result.current.status).toBe('loaded');
    const warmedVideo = first.result.current.status === 'loaded' ? first.result.current.resource : null;
    expect(warmedVideo).toBeInstanceOf(HTMLVideoElement);
    expect(getVideoPoolStats()).toMatchObject({
      warmHitCount: 1,
    });

    first.unmount();
    warm.release();

    const second = renderHook(() => useKVideo('asset://clip.mp4', {
      autoplay: false,
      loop: false,
      muted: true,
      playbackRate: 1,
    }, false, 'show:node:video-1'));

    expect(second.result.current.status).toBe('loaded');
    if (second.result.current.status === 'loaded') {
      expect(second.result.current.resource).not.toBe(warmedVideo);
    }
    expect(getVideoPoolStats()).toMatchObject({
      warmHitCount: 1,
    });
  });

  it('replays a dedicated warm claim safely under StrictMode and reports the adopted element in pool stats', () => {
    const createElementSpy = vi.spyOn(document, 'createElement');
    const warm = warmVideoClaim('show:node:strict-video', 'asset://strict.mp4');

    const hook = renderHook(() => useKVideo('asset://strict.mp4', {
      autoplay: false,
      loop: false,
      muted: true,
      playbackRate: 1,
    }, false, 'show:node:strict-video'), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });

    expect(hook.result.current.status).toBe('loaded');
    expect(getVideoPoolStats()).toMatchObject({
      detachedVideoCount: 1,
      detachedLoadedCount: 1,
      warmHitCount: 1,
      warmMissCount: 0,
    });
    expect(createElementSpy.mock.calls.filter(([tag]) => String(tag) === 'video')).toHaveLength(1);

    hook.unmount();
    warm.release();
  });

  it('reports stable pool snapshots until a real pool mutation occurs', () => {
    const first = getVideoPoolStats();
    const second = getVideoPoolStats();
    expect(second).toBe(first);

    const warm = warmVideoSource('asset://stats.mp4');
    const afterWarm = getVideoPoolStats();
    expect(afterWarm).not.toBe(first);
    expect(getVideoPoolStats()).toBe(afterWarm);

    warm.release();
    const afterRelease = getVideoPoolStats();
    expect(afterRelease).not.toBe(afterWarm);
  });
});
