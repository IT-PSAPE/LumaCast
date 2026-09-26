import type { HostPlatform, SuiteAppDescriptor, SuiteAppId } from '@lumacast/suite';

export interface UpdaterCachePlan {
  /** The platform cache root electron-updater resolves (`getAppCacheDir`). */
  root: string;
  /** `<root>/<updaterCacheDirName>` for this app. */
  dir: string;
}

/**
 * Where electron-updater keeps an app's downloaded updates on the POSIX
 * platforms. Mirrors electron-updater's `getAppCacheDir`: `~/Library/Caches`
 * on macOS and `~/.cache` on Linux (`XDG_CACHE_HOME` is not consulted
 * because the adapter is pure over its injected env; a custom XDG cache home
 * simply leaves that directory in place). Windows resolves `%LOCALAPPDATA%`
 * in its own adapter, next to the per-user install location it also derives.
 */
export function updaterCacheDir(
  app: SuiteAppDescriptor,
  platform: 'darwin' | 'linux',
  env: { homeDir: string },
): UpdaterCachePlan {
  const root = platform === 'darwin' ? `${env.homeDir}/Library/Caches` : `${env.homeDir}/.cache`;
  return { root, dir: `${root}/${UPDATER_CACHE_DIR_NAMES[app.id]}` };
}

/**
 * electron-builder's `publish.updaterCacheDirName`, one per app's own
 * electron-builder.yml (apps/cast/electron-builder.yml,
 * apps/flux/electron-builder.yml, apps/cloud/electron-builder.yml). Not
 * derivable from `SuiteAppDescriptor`, so hardcoded here; keep in sync if a
 * yml's `updaterCacheDirName` ever changes.
 */
export const UPDATER_CACHE_DIR_NAMES: Record<SuiteAppId, string> = {
  cast: 'lumacast-updater',
  flux: 'lumaflux-updater',
  cloud: 'lumacloud-updater',
};

/**
 * Candidate user-data directory names under Electron's `appData` for a
 * managed app. A packaged app's userData dir is Electron's default
 * (`app.getName()`, which equals `productName` for an electron-builder
 * build), so there is exactly one candidate today on every platform; this
 * stays an array, and keeps the `platform` parameter, so a future alternate
 * name (a rename, a legacy pre-monorepo dir) can be added per platform
 * without changing call sites.
 */
export function userDataDirCandidates(
  app: SuiteAppDescriptor,
  _platform: HostPlatform,
): string[] {
  return [app.productName];
}
