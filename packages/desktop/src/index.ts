// Public entry for @lumacast/desktop. Main-process only: `createAppWindow`
// imports Electron. Window-chrome constants live in @lumacast/kernel, shared
// with renderers.
export { windowChromeOptions } from './window-chrome';
export type { WindowChromeOptions, CaptionOverlayColors } from './window-chrome';
export { createAppWindow } from './app-window';
export type { AppWindowOptions } from './app-window';
