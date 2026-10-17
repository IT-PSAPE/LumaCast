import { AUDIO_TRACKS, type AudioTrack } from '../shared/desktop-api';

export function audioTrackGainValues(tracks: readonly AudioTrack[]): Array<0 | 1> {
  const selected = new Set(tracks);
  return AUDIO_TRACKS.map((track): 0 | 1 => selected.has(track) ? 1 : 0);
}
