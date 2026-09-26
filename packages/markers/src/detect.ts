// Detects which of the three cue formats a piece of text is, and dispatches
// to the matching parser/formatter so callers don't have to switch on
// CueFormat themselves.
import type { CueFormat, ParseResult, TimedCue } from './types';
import { parseTimestamp } from './timestamp';
import { formatCsv, parseCsv } from './csv';
import { formatLrc, parseLrc } from './lrc';
import { formatSrt, parseSrt } from './srt';

const EXTENSION_RE = /\.([A-Za-z0-9]+)$/;
const LRC_FIRST_LINE_RE = /^\[\d{1,3}:\d{2}/;

function extensionOf(fileName?: string): string | null {
  if (!fileName) return null;
  const match = EXTENSION_RE.exec(fileName.trim());
  return match ? match[1].toLowerCase() : null;
}

// A sniff-only comma split, good enough to inspect the second column when
// deciding whether a file is CSV; parseCsv itself does full RFC 4180
// parsing.
function splitSniffLine(line: string): string[] {
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''));
}

function sniffContent(text: string): CueFormat | null {
  if (text.includes('-->')) return 'srt';

  const lines = text.split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
  if (lines.length > 0 && LRC_FIRST_LINE_RE.test(lines[0].trim())) return 'lrc';

  for (const line of lines.slice(0, 2)) {
    const cells = splitSniffLine(line);
    if (cells.length >= 2 && parseTimestamp(cells[1]) !== null) return 'csv';
  }

  return null;
}

/**
 * Detects the cue format of `text`. Checked by extension first (`.csv`,
 * `.lrc`, `.srt`; `.txt` and anything else falls through to content
 * sniffing): an SRT arrow (`-->`) anywhere, a first line starting with
 * `[mm:ss`, or a comma/quote-delimited line with a parsable timestamp in the
 * second column. Returns null when nothing matches.
 */
export function detectCueFormat(text: string, fileName?: string): CueFormat | null {
  const ext = extensionOf(fileName);
  if (ext === 'csv' || ext === 'lrc' || ext === 'srt') return ext;
  return sniffContent(text);
}

/** Dispatches to the parser matching `format`. */
export function parseCues(text: string, format: CueFormat): ParseResult {
  switch (format) {
    case 'csv':
      return parseCsv(text);
    case 'lrc':
      return parseLrc(text);
    case 'srt':
      return parseSrt(text);
  }
}

/** Dispatches to the formatter matching `format`. */
export function formatCues(cues: readonly TimedCue[], format: CueFormat): string {
  switch (format) {
    case 'csv':
      return formatCsv(cues);
    case 'lrc':
      return formatLrc(cues);
    case 'srt':
      return formatSrt(cues);
  }
}
