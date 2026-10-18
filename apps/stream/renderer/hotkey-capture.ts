// Shared classification logic behind every hotkey-capture input on the
// Hotkeys settings page (global hotkeys, scene switches, source visibility —
// see settings-dialog.tsx's HotkeysPage and the three `capture*Hotkey`
// handlers in App.tsx that call this). Pulled out as a pure function, keyed
// only on the key-event fields it needs, so the capture/cancel/clear
// semantics can be unit tested without rendering the Settings dialog.

/** The subset of a keydown event `classifyHotkeyCapture`/`acceleratorFromKeyEvent` read. */
export interface HotkeyCaptureKeyEvent {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type HotkeyCaptureResult =
  /** A bare modifier key on its own — no error, no change; wait for the real key. */
  | { kind: 'ignore' }
  /** Escape — cancel capture (the caller should blur the input) without recording or clearing anything. */
  | { kind: 'cancel' }
  /** Backspace or Delete — clear the binding. */
  | { kind: 'clear' }
  /** A key was pressed with no modifier (or isn't representable as an accelerator) — show the "use a modifier" error. */
  | { kind: 'invalid' }
  /** A valid Electron accelerator, e.g. "Control+Alt+F9". */
  | { kind: 'accelerator'; value: string };

/** Converts a captured keydown event into an Electron accelerator string, e.g. "Control+Alt+F9". */
export function acceleratorFromKeyEvent(event: HotkeyCaptureKeyEvent): string | null {
  const key = event.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null;
  const modifiers = [event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Super' : ''].filter(Boolean);
  let acceleratorKey = '';
  if (/^[a-z0-9]$/i.test(key)) acceleratorKey = key.toUpperCase();
  else if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) acceleratorKey = key.toUpperCase();
  else if (key === ' ') acceleratorKey = 'Space';
  else if (key === '+') acceleratorKey = 'Plus';
  else if (key.startsWith('Arrow')) acceleratorKey = key.slice('Arrow'.length);
  else if (key === 'Escape') acceleratorKey = 'Escape';
  else if (key === 'Enter') acceleratorKey = 'Enter';
  else if (key.length === 1) acceleratorKey = key;
  if (!acceleratorKey || modifiers.length === 0) return null;
  return [...modifiers, acceleratorKey].join('+');
}

/**
 * Classifies a keydown event inside a hotkey-capture input, once the caller
 * has already let Tab fall through (so focus still moves) and filtered out
 * key repeats. Escape always cancels — never gets recorded as a shortcut,
 * even with a modifier held.
 */
export function classifyHotkeyCapture(event: HotkeyCaptureKeyEvent): HotkeyCaptureResult {
  if (event.key === 'Escape') return { kind: 'cancel' };
  if (event.key === 'Backspace' || event.key === 'Delete') return { kind: 'clear' };
  const accelerator = acceleratorFromKeyEvent(event);
  if (!accelerator) return ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key) ? { kind: 'ignore' } : { kind: 'invalid' };
  return { kind: 'accelerator', value: accelerator };
}
