// The content of `ColorField`'s `picker` popover: the OS-native colour picker.
// `<input type="color">` only carries RGB, so any alpha suffix on the current
// value is re-appended to every emitted colour.
import { useCallback } from 'react';

export interface NativeColorPickerProps {
  /** `#RRGGBB` or `#RRGGBBAA`. */
  value: string;
  onValueChange: (value: string) => void;
}

export function NativeColorPicker({ value, onValueChange }: NativeColorPickerProps) {
  const rgb = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : '#000000';
  const alpha = /^#[0-9a-f]{8}$/i.test(value) ? value.slice(7) : '';

  // Opens the OS picker as soon as the popover mounts (the click that opened
  // the popover supplies the user activation `showPicker` requires). If the
  // browser refuses, the visible input below still opens it on click.
  const openOnMount = useCallback((element: HTMLInputElement | null) => {
    try {
      element?.showPicker();
    } catch {
      // Not allowed without user activation; the input stays clickable.
    }
  }, []);

  return (
    <input
      ref={openOnMount}
      type="color"
      aria-label="Choose colour"
      value={rgb}
      onChange={(event) => onValueChange(event.target.value + alpha)}
      className="block h-8 w-24 cursor-pointer rounded-sm border border-primary bg-transparent p-0"
    />
  );
}
