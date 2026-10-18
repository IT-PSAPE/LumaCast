import type { BrowserWindowConstructorOptions } from 'electron';
import type { StreamPlatform } from '../shared/platform-capabilities';

/** Height, in CSS pixels, of the custom title bar rendered by the renderer (`renderer/chrome/title-bar.tsx`). Matches the Windows/Linux `titleBarOverlay.height` below so the native caption buttons line up with it. */
export const TITLE_BAR_HEIGHT = 36;

/**
 * Per-platform window chrome for the main window: a custom title bar on every
 * platform that still keeps native window controls.
 *
 * macOS keeps the native traffic lights (`hiddenInset`) inset to align with
 * the title bar's left padding; Windows/Linux hide the native title bar
 * (`hidden`) and ask Electron for an overlay with native caption buttons
 * (`titleBarOverlay`) painted in the title bar's own colors so they read as
 * one piece with the renderer's bar rather than a mismatched native strip.
 */
export function mainWindowChromeOptions(
  platform: StreamPlatform,
): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition'> {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 11 },
    };
  }

  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#191c22',
      symbolColor: '#cbd1d9',
      height: TITLE_BAR_HEIGHT,
    },
  };
}
