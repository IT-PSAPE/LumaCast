import { describe, expect, it } from 'vitest';
import { allowsSpeakerSelection } from '../../../../apps/stream/main/audio-output-permissions';

describe('Stream speaker-selection permission', () => {
  it('allows speaker selection only for trusted main-frame requests', () => {
    expect(allowsSpeakerSelection('speaker-selection', true, true, true)).toBe(true);
    expect(allowsSpeakerSelection('speaker-selection', false, true, true)).toBe(false);
    expect(allowsSpeakerSelection('speaker-selection', true, false, true)).toBe(false);
    expect(allowsSpeakerSelection('speaker-selection', true, true, false)).toBe(false);
  });

  it('does not grant other permissions through the speaker-selection policy', () => {
    expect(allowsSpeakerSelection('media', true, true, true)).toBe(false);
    expect(allowsSpeakerSelection('display-capture', true, true, true)).toBe(false);
  });
});
