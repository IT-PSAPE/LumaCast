export interface AppIdentity {
  /** Window title, app name, and About panel name. */
  name: string;
  /** Bundle identifier / Windows AppUserModelID. Must stay unique per app. */
  id: string;
}

// Deliberately not read from the environment: a stable bundle id and product
// name are what keep Lumaflux's installers, user-data directory, and update
// feed separate from LumaCast's. Overridable values here would let a packaged
// Flux build claim the Cast identity on disk. These are the identity the
// standalone Lumaflux app shipped with, so existing installs keep updating in
// place rather than appearing as a second app.
export const APP_IDENTITY: AppIdentity = Object.freeze({
  name: 'Lumaflux',
  id: 'app.lumaflux.desktop',
});
