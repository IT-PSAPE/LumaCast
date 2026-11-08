import { useState, type FocusEvent, type KeyboardEvent } from 'react';

// Base UI focuses the visually hidden native input inside the visible thumb.
// Draw the mark on that thumb, using the same focus role as other controls.
export const sliderThumbFocusStyles = 'has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-focus-ring has-[input:focus-visible]:-outline-offset-2 forced-colors:has-[input:focus-visible]:outline-[Highlight]';

export function useSliderFocus() {
  // Programmatic pointer focus can match :focus-visible in Chromium. Keep it
  // masked until a keyboard interaction or a fresh entry from another control.
  const [pointerFocus, setPointerFocus] = useState(false);
  return {
    pointerFocus,
    markPointerFocus: () => setPointerFocus(true),
    onKeyDownCapture(event: KeyboardEvent<HTMLElement>) {
      if (!['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) setPointerFocus(false);
    },
    onBlurCapture(event: FocusEvent<HTMLElement>) {
      // Moving between a range slider's two native inputs is still the same
      // interaction. Clearing here would expose a pointer-only focus ring.
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
        setPointerFocus(false);
      }
    },
  };
}
