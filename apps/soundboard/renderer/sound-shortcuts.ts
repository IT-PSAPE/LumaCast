import { useEffect, useRef } from "react";
import type { SoundShortcut } from "../shared/desktop-api";
import type { SaveSoundSettings } from "./sound-ports";

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

// Range handles are not text entry: I/O must work while one is focused.
export function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return target.closest("input:not([type='range']), textarea, select, [contenteditable='true']") !== null;
}

export function shortcutLabel(shortcut: SoundShortcut | null | undefined) {
  if (!shortcut) return "No shortcut";
  const parts = [shortcut.ctrl && "Ctrl", shortcut.alt && "Alt", shortcut.shift && "Shift", shortcut.meta && "Meta"].filter(Boolean);
  parts.push(shortcut.code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Arrow/, ""));
  return parts.join(" + ");
}

export function useShortcutRecording({ soundId, recording, onRecordingChange, save }: {
  soundId: string;
  recording: boolean;
  onRecordingChange: (recording: boolean) => void;
  save: SaveSoundSettings;
}) {
  const latest = useRef({ onRecordingChange, save });
  latest.current = { onRecordingChange, save };
  useEffect(() => {
    if (!recording) return;
    const cancel = () => latest.current.onRecordingChange(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!document.hasFocus() || event.repeat || event.isComposing) return;
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (["ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      const shortcut: SoundShortcut = { code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey };
      cancel();
      void latest.current.save(soundId, { shortcut });
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", cancel);
    };
  }, [recording, soundId]);
}
