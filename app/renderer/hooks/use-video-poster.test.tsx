import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useVideoPoster } from './use-video-poster';

type VideoBehavior = 'success' | 'error' | 'stall';

interface FakeVideoState {
  behavior: VideoBehavior;
  width: number;
  height: number;
}

class FakeVideoElement extends EventTarget {
  src = '';
  muted = false;
  playsInline = false;
  preload = '';
  crossOrigin: string | null = null;
  videoWidth = 0;
  videoHeight = 0;
  loadCalls = 0;
  pause = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = '';
  });

  constructor(private readonly state: FakeVideoState) {
    super();
    this.videoWidth = state.width;
    this.videoHeight = state.height;
  }

  load() {
    this.loadCalls += 1;
    if (this.loadCalls > 1) return;
    if (this.state.behavior === 'stall') return;
    queueMicrotask(() => {
      const eventName = this.state.behavior === 'success' ? 'loadeddata' : 'error';
      this.dispatchEvent(new Event(eventName));
    });
  }
}

describe('useVideoPoster', () => {
  const createdVideos: FakeVideoElement[] = [];
  const canvasSizes: Array<{ width: number; height: number }> = [];
  let originalCreateElement: typeof document.createElement;
  let queuedStates: FakeVideoState[] = [];

  async function flushPosterWork() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    createdVideos.length = 0;
    canvasSizes.length = 0;
    queuedStates = [];
    originalCreateElement = document.createElement.bind(document);

    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'video') {
        const state = queuedStates.shift() ?? { behavior: 'success', width: 1920, height: 1080 };
        const video = new FakeVideoElement(state);
        createdVideos.push(video);
        return video as unknown as HTMLElement;
      }
      if (tagName === 'canvas') {
        const canvas = {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({
            drawImage: vi.fn(),
          })),
          toDataURL: vi.fn((type?: string) => {
            canvasSizes.push({ width: canvas.width, height: canvas.height });
            return `data:${type ?? 'image/png'};base64,${canvas.width}x${canvas.height}`;
          }),
        };
        return canvas as unknown as HTMLElement;
      }
      return originalCreateElement(tagName);
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    cleanup();
  });

  it('waits for enablement before starting extraction', () => {
    renderHook(({ enabled }) => useVideoPoster('video-disabled', enabled), {
      initialProps: { enabled: false },
    });

    expect(createdVideos).toHaveLength(0);
  });

  it('downscales posters before encoding them', async () => {
    queuedStates.push({ behavior: 'success', width: 1920, height: 1080 });

    const { result } = renderHook(() => useVideoPoster('video-downscale', true));

    await flushPosterWork();

    expect(result.current.status).toBe('ready');
    expect(canvasSizes).toEqual([{ width: 480, height: 270 }]);
    expect(result.current.posterSrc).toBe('data:image/jpeg;base64,480x270');
  });

  it('retries transient failures instead of caching them permanently', async () => {
    queuedStates.push(
      { behavior: 'error', width: 1920, height: 1080 },
      { behavior: 'error', width: 1920, height: 1080 },
    );

    const first = renderHook(() => useVideoPoster('video-retry', true));
    await flushPosterWork();
    await flushPosterWork();
    expect(first.result.current.status).toBe('error');
    first.unmount();

    queuedStates.push({ behavior: 'success', width: 1280, height: 720 });
    const second = renderHook(() => useVideoPoster('video-retry', true));
    await flushPosterWork();

    expect(second.result.current.status).toBe('ready');
    expect(createdVideos).toHaveLength(3);
  });

  it('times out stalled loads and tears the media element down', async () => {
    vi.useFakeTimers();
    queuedStates.push(
      { behavior: 'stall', width: 1920, height: 1080 },
      { behavior: 'stall', width: 1920, height: 1080 },
    );

    const { result } = renderHook(() => useVideoPoster('video-timeout', true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(result.current.status).toBe('error');
    expect(createdVideos).toHaveLength(2);
    for (const video of createdVideos) {
      expect(video.pause).toHaveBeenCalled();
      expect(video.removeAttribute).toHaveBeenCalledWith('src');
      expect(video.loadCalls).toBeGreaterThanOrEqual(2);
    }
  });

  it('aborts in-flight work when the last consumer unmounts', async () => {
    queuedStates.push({ behavior: 'stall', width: 1920, height: 1080 });

    const { unmount } = renderHook(() => useVideoPoster('video-abort', true));
    expect(createdVideos).toHaveLength(1);

    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(createdVideos[0]?.pause).toHaveBeenCalled();
    expect(createdVideos[0]?.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('starts a fresh task when a source is reacquired immediately after aborting the prior consumer', async () => {
    queuedStates.push(
      { behavior: 'stall', width: 1920, height: 1080 },
      { behavior: 'success', width: 1280, height: 720 },
    );

    const first = renderHook(() => useVideoPoster('video-reacquire', true));
    expect(createdVideos).toHaveLength(1);

    first.unmount();

    const second = renderHook(() => useVideoPoster('video-reacquire', true));
    expect(createdVideos).toHaveLength(2);

    await flushPosterWork();

    expect(second.result.current.status).toBe('ready');
  });

  it('caps concurrent poster extraction work', async () => {
    queuedStates.push(
      { behavior: 'stall', width: 1920, height: 1080 },
      { behavior: 'stall', width: 1920, height: 1080 },
      { behavior: 'stall', width: 1920, height: 1080 },
    );

    renderHook(() => useVideoPoster('video-queue-a', true));
    renderHook(() => useVideoPoster('video-queue-b', true));
    renderHook(() => useVideoPoster('video-queue-c', true));

    expect(createdVideos).toHaveLength(2);

    createdVideos[0].dispatchEvent(new Event('loadeddata'));
    await act(async () => {
      await Promise.resolve();
    });

    expect(createdVideos).toHaveLength(3);
  });
});
