// The single rule for where the timeline ends: the audio's duration when
// audio is loaded (playback and export are both bound to the audio track),
// else the last cue's own end, else a sane minimum so an empty project still
// has a scrubbable timeline. Pure and imported by both the store (seek/zoom
// clamping, cue-file export) and the timeline UI.
import type { ChordProject } from '../../../shared/project';

const MIN_TIMELINE_END_MS = 10_000;
/** A cue with no explicit end holds the screen this long when it is also the last cue. */
const IMPLICIT_LAST_CUE_DURATION_MS = 4_000;

export function timelineEndMs(project: ChordProject): number {
  const audioDurationMs = project.audio?.durationMs;
  if (audioDurationMs != null) {
    return Math.max(MIN_TIMELINE_END_MS, audioDurationMs);
  }

  const cues = project.cues;
  if (cues.length === 0) return MIN_TIMELINE_END_MS;

  const lastCue = cues[cues.length - 1]!;
  const lastCueEndMs = lastCue.endMs ?? lastCue.startMs + IMPLICIT_LAST_CUE_DURATION_MS;
  return Math.max(MIN_TIMELINE_END_MS, lastCueEndMs);
}
