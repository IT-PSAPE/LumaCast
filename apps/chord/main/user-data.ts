import path from 'node:path';

export interface UserDataPlan {
  /** The name Electron reports for this app (window title, About panel). */
  name: string;
  /** Absolute user-data directory holding recent-projects.json and settings. */
  dir: string;
}

// Mirrors apps/flux/main/user-data.ts's packaged/dev split: a packaged build
// uses the product name (`LumaChord`), a developer checkout uses the
// lower-case internal name (`lumachord`), and the two never collide so a dev
// run cannot edit a packaged install's recent-projects list.
export const PACKAGED_USER_DATA_DIR_NAME = 'LumaChord';
export const DEV_USER_DATA_DIR_NAME = 'lumachord';

export interface ResolveUserDataOptions {
  /** `app.isPackaged`. */
  packaged: boolean;
  /** The platform application-data directory (`app.getPath('appData')`). */
  appData: string;
  /**
   * `LUMACHORD_DATA_DIR`, the documented override for running a second,
   * fully separate data directory (tests, a demo profile). When set it wins
   * outright: the app name still follows the packaged/dev rule, but the
   * directory is exactly what the caller asked for.
   */
  override?: string | undefined;
}

/**
 * Resolves the app name and user-data directory without touching Electron, so
 * the rule is unit-testable and the caller applies it before `app.whenReady()`.
 * Must be called before anything reads `app.getPath('userData')`.
 */
export function resolveUserData(options: ResolveUserDataOptions): UserDataPlan {
  const name = options.packaged ? PACKAGED_USER_DATA_DIR_NAME : DEV_USER_DATA_DIR_NAME;
  const override = options.override;
  const dir = override && override.length > 0
    ? path.resolve(override)
    : path.join(options.appData, options.packaged ? PACKAGED_USER_DATA_DIR_NAME : DEV_USER_DATA_DIR_NAME);

  return { name, dir };
}
