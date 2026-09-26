import { useRef } from 'react';

export const PANEL_RESIZE_MIN = 180;
export const PANEL_RESIZE_MAX = 480;
export const PANEL_RESIZE_KEYBOARD_STEP = 10;

export interface PanelResizeProps {
  width: number;
  onChange: (width: number) => void;
  side: 'left' | 'right';
}

function clamp(width: number) {
  return Math.max(PANEL_RESIZE_MIN, Math.min(PANEL_RESIZE_MAX, width));
}

// PanelResize is a keyboard- and pointer-operable separator for a side panel.
// `side` only flips the drag/key direction; the 180..480 range and the reported
// ARIA values are fixed by the app's panel layout.
export function PanelResize({ width, onChange, side }: PanelResizeProps) {
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-label={`Resize ${side} panel`}
      aria-orientation="vertical"
      aria-valuemin={PANEL_RESIZE_MIN}
      aria-valuemax={PANEL_RESIZE_MAX}
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
          onChange(clamp(width + (e.key === 'ArrowRight' ? PANEL_RESIZE_KEYBOARD_STEP : -PANEL_RESIZE_KEYBOARD_STEP) * (side === 'left' ? 1 : -1)));
        }
      }}
    />
  );
}
