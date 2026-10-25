import type { AppCommand, RatingCommand } from "../shared/app-command";

/** Human-readable primary-modifier chord, e.g. undo (same shape as stream's
 *  `primaryShortcutLabel`). */
export function primaryShortcutLabel(
  platform: string | undefined,
  key: string,
  shift = false,
): string {
  if (platform === "darwin") return `${shift ? "⇧" : ""}⌘${key}`;
  return `Ctrl+${shift ? "Shift+" : ""}${key}`;
}

export interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  target: EventTarget | null;
}

const TEXT_TARGET =
  'input,textarea,select,[contenteditable=""],[contenteditable="true"],[role="slider"],[role="dialog"],[role="combobox"],[role="listbox"],[role="menu"]';

/** True when typing, a slider, a menu or a dialog owns the keyboard. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_TARGET) !== null;
}

/** Maps a keydown to an app command, or null. Letter and digit keys must be
 *  bare (no Cmd/Ctrl/Alt/Shift) so Cmd+E (Export), Cmd+G, Ctrl+G and friends
 *  never trigger them. */
export function resolveShortcut(
  event: ShortcutEvent,
  view: "gallery" | "editor",
): AppCommand | null {
  if (isTypingTarget(event.target)) return null;
  const key = event.key.toLowerCase();
  const primary = event.metaKey || event.ctrlKey;
  if (primary && !event.altKey && !event.shiftKey && key === "a") return "select-all";
  if (primary || event.altKey) return null;
  if (event.key === "ArrowRight") return "next";
  if (event.key === "ArrowLeft") return "previous";
  if (event.key === "Escape") return "library";
  if (event.shiftKey) return null;
  if (key === "j") return view === "editor" ? "toggle-clipping" : null;
  if (key === "g") return "library";
  if (key === "e") return "edit";
  if (event.repeat) return null;
  if (key === "f") return "favorite";
  if (/^[0-5]$/.test(key)) return `rate-${key}` as RatingCommand;
  return null;
}
