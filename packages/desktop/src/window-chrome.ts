import {
  TITLE_BAR_HEIGHT,
  TRAFFIC_LIGHT_HEIGHT,
  TRAFFIC_LIGHT_X,
} from '@lumacast/kernel';

// Declared locally (structurally identical to Electron's types) so this module
// imports nothing and is unit-testable without Electron; the result spreads
// straight into `BrowserWindowConstructorOptions`.
export interface WindowChromeOptions {
  titleBarStyle: 'hidden';
  titleBarOverlay?: { color: string; symbolColor: string; height: number };
  trafficLightPosition?: { x: number; y: number };
}

export interface CaptionOverlayColors {
  /** Overlay background. Native overlays cannot resolve CSS variables, so pass a literal that matches the title bar's background. */
  color: string;
  /** Caption-button glyph color. */
  symbolColor: string;
}

// Matches the shared dark theme's bg-primary (gray-950) and text-secondary (gray-300).
const DEFAULT_OVERLAY_COLORS: CaptionOverlayColors = { color: '#171717', symbolColor: '#CBCBCB' };

/**
 * Window chrome for a custom title bar of `titleBarHeight` CSS px, keeping
 * native window controls on every platform.
 *
 * Always `titleBarStyle: 'hidden'`. On macOS that hides the title bar and
 * leaves the traffic lights to `trafficLightPosition`, which we compute from
 * the bar height so they are vertically centred in it. (`hiddenInset` insets
 * the lights by a system-chosen amount that ignores our bar height and has
 * shifted between macOS releases, so it cannot stay centred in a fixed-height
 * bar.) On Windows/Linux `titleBarOverlay` draws native caption buttons whose
 * height equals the bar's.
 */
export function windowChromeOptions(
  platform: string,
  titleBarHeight: number = TITLE_BAR_HEIGHT,
  overlayColors: CaptionOverlayColors = DEFAULT_OVERLAY_COLORS,
): WindowChromeOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: {
        x: TRAFFIC_LIGHT_X,
        y: Math.max(0, Math.round((titleBarHeight - TRAFFIC_LIGHT_HEIGHT) / 2)),
      },
    };
  }
  // win32 and linux (and anything else): native caption-button overlay.
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...overlayColors, height: titleBarHeight },
  };
}
