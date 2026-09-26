// LRC is a conventional lyric-timing format users already have. A line may
// carry one or more `[mm:ss.xx]`/`[mm:ss.xxx]` timestamp tags followed by the
// lyric text (multiple tags on one line each produce a cue with that same
// text), or an ID tag such as `[ti:]`, `[ar:]`, `[offset:±ms]`. ID tags are
// parsed and otherwise ignored, except `[offset:±ms]`, whose value shifts
// every parsed timestamp.
import type { ParseResult, TimedCue } from './types';

const TIMESTAMP_TAG_RE = /^\[(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?\]/;
const ID_TAG_RE = /^\[([A-Za-z]+):([^\]]*)\]/;

interface RawLrcCue {
  rawMs: number;
  text: string;
}

/**
 * Parses LRC text into cues. Every timestamp tag on a line becomes its own
 * cue sharing that line's text; ID tags (`[ti:]`, `[ar:]`, ...) are parsed
 * and ignored, except `[offset:±ms]`, whose value (the last one found)
 * shifts every parsed timestamp. The result is sorted by `startMs` and
 * renumbered 1..n.
 */
export function parseLrc(text: string): ParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r\n|\r|\n/);
  let offsetMs = 0;
  const raw: RawLrcCue[] = [];

  for (const line of lines) {
    let rest = line;
    const timestampsMs: number[] = [];

    for (;;) {
      const tsMatch = TIMESTAMP_TAG_RE.exec(rest);
      if (tsMatch) {
        const minutes = Number(tsMatch[1]);
        const seconds = Number(tsMatch[2]);
        const fracDigits = tsMatch[3] ?? '';
        const fracMs =
          fracDigits.length > 0 ? Math.round((Number(fracDigits) / 10 ** fracDigits.length) * 1000) : 0;
        timestampsMs.push((minutes * 60 + seconds) * 1000 + fracMs);
        rest = rest.slice(tsMatch[0].length);
        continue;
      }
      const idMatch = ID_TAG_RE.exec(rest);
      if (idMatch) {
        const id = idMatch[1].toLowerCase();
        const value = idMatch[2].trim();
        if (id === 'offset') {
          const parsedOffset = Number(value);
          if (Number.isFinite(parsedOffset)) {
            offsetMs = parsedOffset;
          } else {
            warnings.push(`Ignoring unparseable [offset:] value "${value}"`);
          }
        }
        rest = rest.slice(idMatch[0].length);
        continue;
      }
      break;
    }

    if (timestampsMs.length === 0) continue;
    for (const rawMs of timestampsMs) raw.push({ rawMs, text: rest });
  }

  const cues: TimedCue[] = raw
    .map((r) => ({ startMs: Math.max(0, r.rawMs + offsetMs), text: r.text }))
    .sort((a, b) => a.startMs - b.startMs)
    .map((row, idx) => ({ order: idx + 1, startMs: row.startMs, endMs: null, text: row.text }));

  return { cues, warnings };
}

function formatLrcTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) {
    throw new RangeError(`formatLrc: expected a finite number of milliseconds, got ${ms}`);
  }
  const clamped = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  let minutes = Math.floor(totalSeconds / 60);
  let seconds = totalSeconds % 60;
  let centiseconds = Math.round((clamped % 1000) / 10);
  // Rounding to centiseconds can roll 99.5+ up to 100; carry it forward.
  if (centiseconds >= 100) {
    centiseconds -= 100;
    seconds += 1;
    if (seconds >= 60) {
      seconds -= 60;
      minutes += 1;
    }
  }
  const pad = (value: number, width: number) => String(value).padStart(width, '0');
  return `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(centiseconds, 2)}`;
}

/**
 * Formats cues as LRC: `[mm:ss.xx]text` per cue, in the given order. Blank
 * text still produces a timestamp-only line.
 */
export function formatLrc(cues: readonly TimedCue[]): string {
  return cues.map((cue) => `[${formatLrcTimestamp(cue.startMs)}]${cue.text}`).join('\n');
}
