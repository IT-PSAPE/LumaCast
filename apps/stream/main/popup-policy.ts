// Hardening applied to every popup window spawned from the main window's
// `setWindowOpenHandler` (projector and multiview windows — see window.ts).
// Those popups only ever render content the main window itself hands them
// (an `about:blank` document filled in by the renderer); they have no
// business navigating elsewhere or spawning further windows, so both are
// denied outright. Factored out as a pure function of a `WebContents`-like
// object so it can be unit-tested without booting Electron.

export interface PreventableEvent {
  preventDefault(): void;
}

export interface HardenablePopupWebContents {
  on(event: 'will-navigate', listener: (event: PreventableEvent, url: string) => void): unknown;
  setWindowOpenHandler(handler: () => { action: 'deny' }): void;
}

/** Denies in-place navigation and any further `window.open` popups from a popup's own web contents. */
export function hardenPopupWebContents(webContents: HardenablePopupWebContents): void {
  webContents.on('will-navigate', (event) => { event.preventDefault(); });
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
