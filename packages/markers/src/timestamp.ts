// Timestamp formatting/parsing shared by every cue format in this package.
// `formatTimestamp`/`parseTimestamp` speak the `HH:MM:SS.mmm` shape SRT and
// CSV both use (SRT swaps the '.' for a ',' at format time in srt.ts); LRC
// uses its own centisecond `mm:ss.xx` shape local to lrc.ts.

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/**
 * Formats a millisecond count as `HH:MM:SS.mmm`: hours are always at least
 * two digits, minutes/seconds are zero-padded to two digits, milliseconds to
 * three. Negative values clamp to zero; non-finite values throw.
 */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) {
    throw new RangeError(`formatTimestamp: expected a finite number of milliseconds, got ${ms}`);
  }
  const clamped = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const millis = clamped % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}

// Every non-fractional component (hours/minutes, or the whole value when
// there is no colon at all) must be plain digits.
const INTEGER_COMPONENT_RE = /^\d+$/;
// The last colon-delimited component, which may carry a fractional part
// introduced by '.' or ','.
const LAST_COMPONENT_RE = /^(\d+)(?:[.,](\d+))?$/;

/**
 * Parses `HH:MM:SS.mmm`, `MM:SS.mmm`, `SS.mmm`, or `H:M:S` (','  or '.' as the
 * fractional separator, optional surrounding whitespace), plus a bare decimal
 * number interpreted as seconds (e.g. `90.5` -> 90500). Returns null for
 * anything else. Milliseconds are rounded to the nearest integer.
 */
export function parseTimestamp(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const parts = trimmed.split(':');
  if (parts.length > 3) return null;

  const lastMatch = LAST_COMPONENT_RE.exec(parts[parts.length - 1]);
  if (!lastMatch) return null;
  const seconds = Number(lastMatch[1]);
  const fracDigits = lastMatch[2] ?? '';
  const fracMs = fracDigits.length > 0 ? (Number(fracDigits) / 10 ** fracDigits.length) * 1000 : 0;

  let minutes = 0;
  let hours = 0;
  if (parts.length >= 2) {
    const minutePart = parts[parts.length - 2];
    if (!INTEGER_COMPONENT_RE.test(minutePart)) return null;
    minutes = Number(minutePart);
  }
  if (parts.length === 3) {
    const hourPart = parts[0];
    if (!INTEGER_COMPONENT_RE.test(hourPart)) return null;
    hours = Number(hourPart);
  }

  const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000 + fracMs;
  return Math.round(totalMs);
}
