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

export type OverlayTheme = 'light' | 'dark';

// Literal hex resolved from packages/ui/src/theme.css (titleBarOverlay cannot read CSS variables).
// Re-resolve these if the tokens change.
export const OVERLAY_COLORS: Record<OverlayTheme, CaptionOverlayColors> = {
  light: {
    color: '#F6F6F6', // --background-color-secondary -> --color-gray-50
    symbolColor: '#2D2D2D', // --text-color-secondary -> --color-gray-700
  },
  dark: {
    color: '#1A1A1A', // [data-theme="dark"] --background-color-secondary -> --color-gray-900
    symbolColor: '#CBCBCB', // [data-theme="dark"] --text-color-secondary -> --color-gray-300
  },
};

const DEFAULT_OVERLAY_COLORS: CaptionOverlayColors = OVERLAY_COLORS.dark;

/** The slice of BrowserWindow that `applyTitleBarOverlay` needs; structural so it is testable without Electron. */
export interface TitleBarOverlayTarget {
  isDestroyed(): boolean;
  setTitleBarOverlay?: (options: { color: string; symbolColor: string; height: number }) => void;
}

/**
 * Re-colours the native caption buttons of a live window for `theme`.
 * No-op on macOS (no overlay), where `setTitleBarOverlay` is unavailable, or
 * once the window is destroyed. Never throws.
 */
export function applyTitleBarOverlay(
  window: TitleBarOverlayTarget,
  theme: OverlayTheme,
  platform: string = process.platform,
  titleBarHeight: number = TITLE_BAR_HEIGHT,
): void {
  if (platform === 'darwin') return;
  try {
    if (window.isDestroyed() || typeof window.setTitleBarOverlay !== 'function') return;
    window.setTitleBarOverlay({ ...OVERLAY_COLORS[theme], height: titleBarHeight });
  } catch {
    // Window torn down mid-call, or overlay not enabled on this window.
  }
}

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
