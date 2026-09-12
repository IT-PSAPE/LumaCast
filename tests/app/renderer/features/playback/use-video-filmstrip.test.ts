import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFilmstripFrameSize, getFilmstripSampleTimes, useVideoFilmstrip } from '../../../../../app/renderer/features/playback/use-video-filmstrip';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function FilmstripProbe({ src }: { src: string }) {
  const filmstrip = useVideoFilmstrip(src);
  return createElement('div', { 'data-status': filmstrip.status }, filmstrip.frames.length);
}

describe('getFilmstripSampleTimes', () => {
  it('spans the video without seeking to the exact end frame', () => {
    const times = getFilmstripSampleTimes(10, 5);
    expect(times).toHaveLength(5);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBeGreaterThan(9.9);
    expect(times.at(-1)).toBeLessThan(10);
    expect(times).toEqual([...times].sort((left, right) => left - right));
  });

  it('handles invalid durations and a single thumbnail', () => {
    expect(getFilmstripSampleTimes(0)).toEqual([]);
    expect(getFilmstripSampleTimes(Number.NaN)).toEqual([]);
    expect(getFilmstripSampleTimes(8, 0)).toEqual([]);
    expect(getFilmstripSampleTimes(8, 1)).toEqual([4]);
  });
});

describe('getFilmstripFrameSize', () => {
  it('preserves landscape and portrait aspect ratios inside the frame bounds', () => {
    expect(getFilmstripFrameSize(1920, 1080)).toEqual({ width: 160, height: 90 });
    expect(getFilmstripFrameSize(1080, 1920)).toEqual({ width: 51, height: 90 });
  });

  it('rejects invalid source dimensions', () => {
    expect(getFilmstripFrameSize(0, 1080)).toBeNull();
    expect(getFilmstripFrameSize(1080, Number.NaN)).toBeNull();
  });
});

describe('useVideoFilmstrip', () => {
  it('keeps one extraction job alive when the transport tab unmounts and remounts', async () => {
    const originalCreateElement = document.createElement.bind(document);
    let videoElementsCreated = 0;
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'video') {
        videoElementsCreated += 1;
        Object.defineProperty(element, 'load', { configurable: true, value: vi.fn() });
        Object.defineProperty(element, 'pause', { configurable: true, value: vi.fn() });
      }
      return element;
    }) as typeof document.createElement);

    const first = render(createElement(FilmstripProbe, { src: 'cast-media://continuous-video' }));
    await waitFor(() => expect(videoElementsCreated).toBe(1));
    first.unmount();
    render(createElement(FilmstripProbe, { src: 'cast-media://continuous-video' }));

    await waitFor(() => expect(videoElementsCreated).toBe(1));
  });
});
