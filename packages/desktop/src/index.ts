// Public entry for @lumacast/desktop. Main-process only: `createAppWindow`
// imports Electron. Window-chrome constants live in @lumacast/kernel, shared
// with renderers.
export { windowChromeOptions, applyTitleBarOverlay, OVERLAY_COLORS } from './window-chrome';
export type { WindowChromeOptions, CaptionOverlayColors, OverlayTheme, TitleBarOverlayTarget } from './window-chrome';
export { createAppWindow } from './app-window';
export type { AppWindowOptions } from './app-window';
