// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { setMediaPlaybackActive, shouldShowMediaFrame } from '../../../../apps/stream/renderer/media-playback';

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
  it('pauses while inactive and restarts at the beginning when activated by default', () => {
    const element = mediaElement();
    setMediaPlaybackActive(element, false, true);
    expect(element.pause).toHaveBeenCalledOnce();
    expect(element.play).not.toHaveBeenCalled();

    setMediaPlaybackActive(element, true, true);
    expect(element.currentTime).toBe(0);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it('resumes from the paused position when restart-on-activation is disabled', () => {
    const element = mediaElement({ currentTime: 8 });
    setMediaPlaybackActive(element, true, false);
    expect(element.currentTime).toBe(8);
    expect(element.play).toHaveBeenCalledOnce();
  });

  it('does not restart completed media when resume mode is selected', () => {
    const element = mediaElement({ ended: true });
    setMediaPlaybackActive(element, true, false);
    expect(element.play).not.toHaveBeenCalled();
  });

  it('clears ended media frames by default and can retain the last frame', () => {
    expect(shouldShowMediaFrame(false, true)).toBe(true);
    expect(shouldShowMediaFrame(true, true)).toBe(false);
    expect(shouldShowMediaFrame(true, false)).toBe(true);
  });
});
