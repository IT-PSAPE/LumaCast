// SRT is a conventional caption format users already have. A block is an
// optional index line, a `HH:MM:SS,mmm --> HH:MM:SS,mmm` timing line, then
// one or more text lines, separated from the next block by a blank line.
import type { ParseResult, TimedCue } from './types';
import { formatTimestamp, parseTimestamp } from './timestamp';

const INDEX_LINE_RE = /^\d+$/;
const ARROW = '-->';

interface RawSrtCue {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Parses SRT text into cues. Tolerant of a missing index line and of `.`
 * fractional separators in the timing line (parseTimestamp accepts both).
 * The result is sorted by `startMs` and renumbered 1..n.
 */
export function parseSrt(text: string): ParseResult {
  const warnings: string[] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  const raw: RawSrtCue[] = [];

  blocks.forEach((block, blockIdx) => {
    const lines = block.split('\n');
    let i = 0;
    if (i < lines.length && INDEX_LINE_RE.test(lines[i].trim())) {
      i += 1;
    }
    if (i >= lines.length) {
      warnings.push(`Block ${blockIdx + 1}: skipped (no timing line)`);
      return;
    }

    const timingLine = lines[i];
    const arrowIdx = timingLine.indexOf(ARROW);
    if (arrowIdx === -1) {
      warnings.push(`Block ${blockIdx + 1}: skipped (missing "${ARROW}" timing line)`);
      return;
    }

    const startRaw = timingLine.slice(0, arrowIdx).trim();
    // Some SRT variants append rendering hints after the end timestamp
    // (e.g. "X1:1 X2:2 Y1:3 Y2:4"); only the first token is the timestamp.
    const endRaw = (timingLine.slice(arrowIdx + ARROW.length).trim().split(/\s+/)[0] ?? '').trim();

    const startMs = parseTimestamp(startRaw);
    const endMs = parseTimestamp(endRaw);
    if (startMs === null || endMs === null) {
      warnings.push(`Block ${blockIdx + 1}: skipped (unparseable timing "${timingLine.trim()}")`);
      return;
    }

    raw.push({ startMs, endMs, text: lines.slice(i + 1).join('\n') });
  });

  const cues: TimedCue[] = raw
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
    .map((row, idx) => ({ order: idx + 1, startMs: row.startMs, endMs: row.endMs, text: row.text }));

  return { cues, warnings };
}

function formatSrtTimestamp(ms: number): string {
  return formatTimestamp(ms).replace('.', ',');
}

/**
 * Formats cues as SRT, in the given order, renumbered from 1. A cue with
 * `endMs === null` ends at the next cue's start, or at
 * `startMs + defaultDurationMs` (default 4000ms) for the last cue.
 */
export function formatSrt(cues: readonly TimedCue[], options?: { defaultDurationMs?: number }): string {
  const defaultDurationMs = options?.defaultDurationMs ?? 4000;
  const blocks = cues.map((cue, idx) => {
    const next = cues[idx + 1];
    const endMs = cue.endMs ?? (next ? next.startMs : cue.startMs + defaultDurationMs);
    const timing = `${formatSrtTimestamp(cue.startMs)} ${ARROW} ${formatSrtTimestamp(endMs)}`;
    return `${idx + 1}\n${timing}\n${cue.text}`;
  });
  return blocks.join('\n\n');
}
