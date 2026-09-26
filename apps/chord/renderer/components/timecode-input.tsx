// A MM:SS.mmm timecode field for cue start/end. When `allowAuto` is set (the
// cue end, which may hold until the next cue starts), typing "Auto" or
// clearing the field commits `null`.
import { useEffect, useRef, useState } from 'react';

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
  const display = () => (ms === null ? 'Auto' : formatTimecode(ms));
  const [draft, setDraft] = useState(display);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(display());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);

  function commit() {
    const trimmed = draft.trim();
    if (allowAuto && (trimmed === '' || /^auto$/i.test(trimmed))) {
      onCommit(null);
      return;
    }
    const parsed = parseTimecode(trimmed);
    if (parsed !== null) onCommit(parsed);
    else setDraft(display());
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      disabled={disabled}
      value={draft}
      placeholder={allowAuto ? 'Auto' : '00:00.000'}
      onFocus={() => { focused.current = true; }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(display());
          event.currentTarget.blur();
        }
      }}
      className="label-xs min-h-8 w-full min-w-0 rounded-sm bg-tertiary px-2 font-mono text-primary outline-none transition-colors focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-50"
    />
  );
}
