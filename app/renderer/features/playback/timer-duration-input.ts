// Pure parse/format helpers for the timers panel's duration text inputs
// (timer duration, elapsed start/end, threshold time). Independent of
// `Timer.format` (mm:ss/hh:mm:ss), which only controls the live readout —
// these inputs always show/accept the shortest form that round-trips.
//
// Accepted input: a bare number ("5") is minutes, so it agrees with the
// "M:SS" form ("5:00") it formats back to. Two segments are "M:SS", three
// are "H:MM:SS".

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

export function parseDurationSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const parts = trimmed.split(':').map((part) => part.trim());
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;

  const numbers = parts.map(Number);
  if (numbers.length === 1) return numbers[0] * 60;
  if (numbers.length === 2) return numbers[0] * 60 + numbers[1];
  return numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

export function formatDurationInput(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}
