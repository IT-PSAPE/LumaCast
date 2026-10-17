// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { listenForMediaStreamEnd } from '../../../../apps/stream/renderer/media-stream-ended';

class FakeTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live';

  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

describe('media stream end listener', () => {
  it('fires once after every track ends and removes its listeners', () => {
    const audio = new FakeTrack();
    const video = new FakeTrack();
    const onEnd = vi.fn();
    listenForMediaStreamEnd({ getTracks: () => [audio, video] }, onEnd);

    audio.end();
    expect(onEnd).not.toHaveBeenCalled();
    video.end();
    expect(onEnd).toHaveBeenCalledOnce();
    audio.end();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('can detach before the tracks end', () => {
    const audio = new FakeTrack();
    const onEnd = vi.fn();
    const detach = listenForMediaStreamEnd({ getTracks: () => [audio] }, onEnd);

    detach();
    audio.end();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
