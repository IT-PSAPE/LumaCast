// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { retainDesktopAudioTracks } from '../../../../apps/stream/renderer/desktop-audio-capture';

describe('desktop audio capture tracks', () => {
  it('stops captured video immediately and retains audio for the mixer', () => {
    const videoTrack = { kind: 'video', stop: vi.fn() } as unknown as MediaStreamTrack;
    const audioTrack = { kind: 'audio', stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = {
      getAudioTracks: () => [audioTrack],
      getTracks: () => [videoTrack, audioTrack],
    };

    expect(retainDesktopAudioTracks(stream)).toEqual([audioTrack]);
    expect(videoTrack.stop).toHaveBeenCalledOnce();
    expect(audioTrack.stop).not.toHaveBeenCalled();
  });

  it('stops video even when Windows provides no loopback track', () => {
    const videoTrack = { kind: 'video', stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = { getAudioTracks: () => [], getTracks: () => [videoTrack] };

    expect(retainDesktopAudioTracks(stream)).toEqual([]);
    expect(videoTrack.stop).toHaveBeenCalledOnce();
  });
});
