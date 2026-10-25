// Window-chrome geometry: a contract between the main process (which builds
// BrowserWindow options from it) and the renderer (which pads its custom title
// bar from it). Neither owns it, so it lives in kernel; both must import it
// here instead of hardcoding, or they drift.

/** Height, in CSS pixels, of the custom title bar. Also the Windows/Linux `titleBarOverlay.height`, so the native caption buttons line up with the renderer's bar. */
export const TITLE_BAR_HEIGHT = 36;

/** Height, in points, of the macOS traffic-light cluster as Electron positions it. */
export const TRAFFIC_LIGHT_HEIGHT = 14;

/** Distance from the window's left edge to the traffic lights (the `trafficLightPosition.x` main passes). */
export const TRAFFIC_LIGHT_X = 14;

/** macOS: left padding (CSS px) a title bar needs to clear the traffic lights. */
export const TITLE_BAR_INSET_LEFT_DARWIN = 78;

/** Windows/Linux: ordinary left padding (CSS px); there is nothing native on the left. */
export const TITLE_BAR_INSET_LEFT_OVERLAY = 8;

/** Windows/Linux: right padding (CSS px) a title bar needs to clear the native `titleBarOverlay` caption buttons. */
export const TITLE_BAR_INSET_RIGHT_OVERLAY = 140;
