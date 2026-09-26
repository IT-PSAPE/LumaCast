export interface AppIdentity {
  /** Window title, app name, and About panel name. */
  name: string;
  /** Bundle identifier / Windows AppUserModelID. Must stay unique per app. */
  id: string;
}

// Deliberately not read from the environment: a stable bundle id and product
// name are what keep LumaCloud's installers, user-data directory, and update
// feed separate from LumaCast's. Overridable values here would let a packaged
// Cloud build claim the Cast identity on disk.
export const APP_IDENTITY: AppIdentity = Object.freeze({
  name: 'LumaCloud',
  id: 'com.lumacast.cloud',
});
