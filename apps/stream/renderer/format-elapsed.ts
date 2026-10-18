/**
 * Formats a duration in milliseconds as a clock readout. `'compact'` (the
 * default, used by the narrow YouTube dock) omits the hours segment while
 * under an hour and leaves it unpadded once shown (`5:23`, `1:05:23`);
 * `'full'` (used by the title bar's recording/streaming chips) always shows
 * zero-padded `HH:MM:SS`.
 */
export function formatElapsed(milliseconds: number, mode: 'full' | 'compact' = 'compact'): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (mode === 'full') return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
