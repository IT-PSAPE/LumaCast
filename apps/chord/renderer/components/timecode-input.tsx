// A MM:SS.mmm timecode field for cue start/end. When `allowAuto` is set (the
// cue end, which may hold until the next cue starts), typing "Auto" or
// clearing the field commits `null`. Draft/commit/Escape handling is the
// package `TextField`'s (`commitOn="blur"`); this adds only timecode parsing.
import { useState } from 'react';
import { TextField } from '@lumacast/ui';

function formatTimecode(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

const TIMECODE_RE = /^(\d{1,3}):([0-5]?\d)(?:[.,](\d{1,3}))?$/;

function parseTimecode(text: string): number | null {
  const match = TIMECODE_RE.exec(text.trim());
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const millis = match[3] ? Number(match[3].padEnd(3, '0')) : 0;
  return minutes * 60_000 + seconds * 1000 + millis;
}

export interface TimecodeInputProps {
  /** `null` means "Auto" (only meaningful with `allowAuto`). */
  ms: number | null;
  onCommit: (ms: number | null) => void;
  allowAuto?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
}

export function TimecodeInput({ ms, onCommit, allowAuto, ariaLabel, disabled }: TimecodeInputProps) {
  // Bumped after every commit so the field remounts and shows the canonical
  // text (or the last valid value after an unparseable entry).
  const [revision, setRevision] = useState(0);

  function commit(text: string) {
    const trimmed = text.trim();
    if (allowAuto && (trimmed === '' || /^auto$/i.test(trimmed))) {
      onCommit(null);
    } else {
      const parsed = parseTimecode(trimmed);
      if (parsed !== null) onCommit(parsed);
    }
    setRevision((n) => n + 1);
  }

  return (
    <TextField
      key={revision}
      value={ms === null ? 'Auto' : formatTimecode(ms)}
      onValueChange={commit}
      commitOn="blur"
      label={ariaLabel}
      labelPlacement="hidden"
      disabled={disabled}
      placeholder={allowAuto ? 'Auto' : '00:00.000'}
      className="font-mono"
    />
  );
}
