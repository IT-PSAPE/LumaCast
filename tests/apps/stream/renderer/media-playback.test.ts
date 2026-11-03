// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { restoreMediaPlaybackPosition, setMediaPlaybackActive, shouldShowMediaFrame } from '../../../../apps/stream/renderer/media-playback';

function mediaElement(overrides: Partial<Pick<HTMLMediaElement, 'currentTime' | 'ended'>> = {}) {
  return {
    currentTime: 8,
    ended: false,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    ...overrides,
  };
}

describe('media playback lifecycle', () => {
  it('ignores the emptied event caused by a source assignment and restores after metadata', async () => {
    const cache = new Map([['video', { currentTime: 7.25, paused: true, ended: false }]]);
    const element = Object.assign(new EventTarget(), { currentTime: 0, duration: 12, readyState: 0 });

    const restore = restoreMediaPlaybackPosition(cache, 'video', element, true);
    element.dispatchEvent(new Event('emptied'));
    expect(element.currentTime).toBe(0);

    element.readyState = 1;
    element.dispatchEvent(new Event('loadedmetadata'));
    await restore.ready;

    expect(element.currentTime).toBe(7.25);
    expect(restore.snapshot).toEqual({ currentTime: 7.25, paused: true, ended: false });
  });

  it('pauses while inactive and resumes from the current position by default', () => {
    const element = mediaElement();
    setMediaPlaybackActive(element, false);
    expect(element.pause).toHaveBeenCalledOnce();
    expect(element.play).not.toHaveBeenCalled();

    setMediaPlaybackActive(element, true);
    expect(element.currentTime).toBe(8);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it('restarts at the beginning when restart-on-activation is explicitly enabled', () => {
    const element = mediaElement();

    setMediaPlaybackActive(element, true, true);

    expect(element.currentTime).toBe(0);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it('does not resume an element whose cached Program state was paused', () => {
    const element = mediaElement({ currentTime: 18 });

    setMediaPlaybackActive(element, true, false, false);

    expect(element.currentTime).toBe(18);
    expect(element.play).not.toHaveBeenCalled();
  });

  it('resumes from the paused position when restart-on-activation is disabled', () => {
    const element = mediaElement({ currentTime: 8 });
    setMediaPlaybackActive(element, true, false);
    expect(element.currentTime).toBe(8);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it('does not restart or issue another play call when the same resource remains active', () => {
    const element = mediaElement({ currentTime: 13 });

    setMediaPlaybackActive(element, true, true);
    setMediaPlaybackActive(element, true, true);

    expect(element.currentTime).toBe(0);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it('restarts only after the resource leaves and re-enters Program', () => {
    const element = mediaElement({ currentTime: 13 });

    setMediaPlaybackActive(element, true, true);
    setMediaPlaybackActive(element, false, true);
    element.currentTime = 19;
    setMediaPlaybackActive(element, true, true);

    expect(element.currentTime).toBe(0);
    expect(element.play).toHaveBeenCalledTimes(2);
    expect(element.pause).toHaveBeenCalledOnce();
  });

  it('does not restart completed media in the default resume mode', () => {
    const element = mediaElement({ ended: true });
    setMediaPlaybackActive(element, true);
    expect(element.play).not.toHaveBeenCalled();
  });

  it('clears ended media frames by default and can retain the last frame', () => {
    expect(shouldShowMediaFrame(false, true)).toBe(true);
    expect(shouldShowMediaFrame(true, true)).toBe(false);
    expect(shouldShowMediaFrame(true, false)).toBe(true);
  });
});
