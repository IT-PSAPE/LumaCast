// Pure time-display formatting, shared by the transport bar's timecode
// readout and the timeline ruler's tick labels.

function pad(value: number, width = 2): string {
  return String(Math.max(0, Math.trunc(value))).padStart(width, '0');
}

/** `MM:SS:FF` — minutes, seconds, and the frame within the current second at `fps`. */
export function formatTimecode(ms: number, fps: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const frame = fps > 0 ? Math.floor(((totalMs % 1000) / 1000) * fps) : 0;
  return `${pad(minutes)}:${pad(seconds)}:${pad(frame)}`;
}

/** `M:SS.t` — minutes (unpadded), seconds, and one decimal of a second. */
export function formatClock(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((totalMs % 1000) / 100);
  return `${minutes}:${pad(seconds)}.${tenths}`;
}
