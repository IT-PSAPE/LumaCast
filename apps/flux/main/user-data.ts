import path from 'node:path';

export interface UserDataPlan {
  /** The name Electron reports for this app (window title, About panel). */
  name: string;
  /** Absolute user-data directory holding the catalog, settings, and the MCP
   *  connection file. */
  dir: string;
}

// Lumaflux shipped from two places before it moved into this monorepo, and both
// have user-data on disk that must keep resolving to the same folder. A
// packaged build has always been the product-named `Lumaflux` directory, while
// a developer checkout has always been lowercase `lumaflux` (Electron derives
// that name from the app's own package name, which cannot contain an uppercase
// F in the packaged case here). Pinning both names explicitly is what
// stops this app — whose npm name is the scoped `@lumacast/flux` — from
// silently adopting a third directory name and orphaning the catalog. The
// packaged spelling is the product name (`Lumaflux`), not the internal-cased
// `LumaFlux`: a one-letter difference is a different directory, and adopting it
// would orphan every existing library, catalog, and settings file.
export const PACKAGED_USER_DATA_DIR_NAME = 'Lumaflux';
export const DEV_USER_DATA_DIR_NAME = 'lumaflux';

export interface ResolveUserDataOptions {
  /** `app.isPackaged`. */
  packaged: boolean;
  /** The platform application-data directory (`app.getPath('appData')`). */
  appData: string;
  /**
   * `LUMAFLUX_DATA_DIR`, the documented override for running a second, fully
   * separate library (tests, a demo catalog). When set it wins outright: the
   * app name still follows the packaged/dev rule, but the directory is exactly
   * what the caller asked for.
   */
  override?: string | undefined;
}

/**
 * Resolves the app name and user-data directory without touching Electron, so
 * the rule is unit-testable and the caller applies it before `app.whenReady()`.
 * Must be called before anything reads `app.getPath('userData')`.
 */
export function resolveUserData(options: ResolveUserDataOptions): UserDataPlan {
  const name = options.packaged ? 'Lumaflux' : DEV_USER_DATA_DIR_NAME;
  const override = options.override;
  const dir = override && override.length > 0
    ? path.resolve(override)
    : path.join(options.appData, options.packaged ? PACKAGED_USER_DATA_DIR_NAME : DEV_USER_DATA_DIR_NAME);

  return { name, dir };
}
