// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { audioTrackGainValues } from '../../../../apps/stream/renderer/audio-track-routing';

describe('Stream audio track routing', () => {
  it('enables only the selected output buses', () => {
    expect(audioTrackGainValues([1, 4, 6])).toEqual([1, 0, 0, 1, 0, 1]);
  });

  it('silences every output bus when a source has no track assignments', () => {
    expect(audioTrackGainValues([])).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('routes the track boundaries to the matching first and sixth buses', () => {
    expect(audioTrackGainValues([1, 6])).toEqual([1, 0, 0, 0, 0, 1]);
  });
});
