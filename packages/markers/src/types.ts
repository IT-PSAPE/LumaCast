// Shared types for @lumacast/markers: a timed lyric cue is the interchange
// unit both LumaCast (which records audio-sync markers) and LumaChord (which
// builds a lyric video from them) trade over CSV, LRC, and SRT.
export interface TimedCue {
  /** 1-based position in the sequence. */
  order: number;
  startMs: number;
  /** Null when the cue runs until the next cue (CSV/LRC have no end). */
  endMs: number | null;
  text: string;
}

export interface ParseResult {
  cues: TimedCue[];
  warnings: string[];
}

export type CueFormat = 'csv' | 'lrc' | 'srt';
