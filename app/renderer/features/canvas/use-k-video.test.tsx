import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLayerVideoElement, retainVideoSource, useKVideo } from './use-k-video';

describe('useKVideo pool retention', () => {
  const originalCreateElement = document.createElement.bind(document);

  beforeEach(() => {
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName !== 'video') return element;

      Object.defineProperty(element, 'readyState', {
        configurable: true,
        value: HTMLMediaElement.HAVE_CURRENT_DATA,
      });
      Object.assign(element, {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        load: vi.fn(),
      });
      return element;
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps an armed layer video alive after SceneStage consumers unmount', () => {
    const src = 'file:///armed-video.mp4';
    const options = { autoplay: true, loop: true, muted: true, playbackRate: 1 };
    const releaseRetainedVideo = retainVideoSource(src, options);
    const { result, unmount } = renderHook(() => useKVideo(src, options));

    expect(result.current.status).toBe('loaded');
    const retainedElement = getLayerVideoElement(src, options);
    expect(retainedElement).toBeTruthy();

    unmount();
    expect(getLayerVideoElement(src, options)).toBe(retainedElement);

    releaseRetainedVideo();
    expect(getLayerVideoElement(src, options)).toBeNull();
  });

  it('reuses the same pooled video element when autoplay changes', () => {
    const src = 'file:///transport-video.mp4';
    const pausedOptions = { autoplay: false, loop: true, muted: false, playbackRate: 1 };
    const playingOptions = { autoplay: true, loop: true, muted: false, playbackRate: 1 };
    const { rerender } = renderHook(
      ({ options }) => useKVideo(src, options),
      { initialProps: { options: pausedOptions } },
    );

    const pausedElement = getLayerVideoElement(src, pausedOptions);
    expect(pausedElement).toBeTruthy();
    if (pausedElement) {
      Object.defineProperty(pausedElement, 'currentTime', {
        configurable: true,
        writable: true,
        value: 19.5,
      });
    }

    rerender({ options: playingOptions });

    const playingElement = getLayerVideoElement(src, playingOptions);
    expect(playingElement).toBe(pausedElement);
    expect(playingElement?.currentTime).toBe(19.5);
  });
});
