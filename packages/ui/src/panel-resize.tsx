import { useRef } from 'react';

export const PANEL_RESIZE_MIN = 180;
export const PANEL_RESIZE_MAX = 480;
export const PANEL_RESIZE_KEYBOARD_STEP = 10;

export interface PanelResizeProps {
  width: number;
  onChange: (width: number) => void;
  side: 'left' | 'right';
  /** Defaults to PANEL_RESIZE_MIN. */
  min?: number;
  /** Defaults to PANEL_RESIZE_MAX. */
  max?: number;
  /** Keyboard step. Defaults to PANEL_RESIZE_KEYBOARD_STEP. */
  step?: number;
}

// PanelResize is a keyboard- and pointer-operable separator for a side panel.
// `side` only flips the drag/key direction; the range defaults to 180..480 (override with
// min/max) and the reported ARIA values follow it. Kept as its own implementation
// rather than built on ResizeHandle: it must keep ignoring Home/End/Enter/Up/Down
// and keep the app-styled `panel-resizer` element, which ResizeHandle does not.
export function PanelResize({ width, onChange, side, min = PANEL_RESIZE_MIN, max = PANEL_RESIZE_MAX, step = PANEL_RESIZE_KEYBOARD_STEP }: PanelResizeProps) {
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-label={`Resize ${side} panel`}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current) {
          onChange(clamp(start.current.width + (e.clientX - start.current.x) * (side === 'left' ? 1 : -1)));
        }
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onChange(clamp(width + (e.key === 'ArrowRight' ? step : -step) * (side === 'left' ? 1 : -1)));
        }
      }}
    />
  );
}
