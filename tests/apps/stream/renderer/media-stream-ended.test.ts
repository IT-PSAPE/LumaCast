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

// Narrow cast at the fake boundary: listenForMediaStreamEnd only reads readyState and
// add/removeEventListener, which FakeTrack implements; the rest of MediaStreamTrack is unused.
function streamOf(...tracks: FakeTrack[]): Pick<MediaStream, 'getTracks'> {
  return { getTracks: () => tracks as unknown as MediaStreamTrack[] };
}

describe('media stream end listener', () => {
  it('fires once after every track ends and removes its listeners', () => {
    const audio = new FakeTrack();
    const video = new FakeTrack();
    const onEnd = vi.fn();
    listenForMediaStreamEnd(streamOf(audio, video), onEnd);

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
    const detach = listenForMediaStreamEnd(streamOf(audio), onEnd);

    detach();
    audio.end();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
