// The registry of managed apps: their identities, product names, and the
// per-app conventions (release tag prefixes, version scheme, installed
// artifact names) that the rest of this package reads to parse releases and
// derive state. This is the single source of truth Cloud renders from.
import type { SuiteAppDescriptor, SuiteAppId } from './types';

/**
 * The organization prefix every current-generation bundle id/AppUserModelID
 * shares. `isManagedIdentity` uses this to recognize a suite app on disk even
 * when the descriptor for it has not been consulted yet.
 */
export const SUITE_ORGANIZATION = 'com.lumacast';

/**
 * Bundle ids that are managed by the suite but do not carry the
 * `com.lumacast.` prefix. Flux shipped under `app.lumaflux.desktop` before
 * the monorepo existed and keeps that identity across the migration — an
 * installed Flux is still a managed app, it is just not discoverable from the
 * organization prefix alone.
 */
export const LEGACY_MANAGED_IDENTITIES: ReadonlySet<string> = new Set(['app.lumaflux.desktop']);

/** Suite apps, in the order Cloud lists them. */
export const SUITE_APPS: readonly SuiteAppDescriptor[] = Object.freeze([
  {
    id: 'cast',
    productName: 'LumaCast',
    bundleId: 'com.lumacast.app',
    summary: 'Presentation and NDI output',
    versionScheme: 'semver',
    releaseTagPrefix: 'cast-v',
    legacyTagPrefix: 'v',
    feedTag: 'cast-feed',
    mac: { bundleName: 'LumaCast.app' },
    win: { executableName: 'LumaCast.exe', displayName: 'LumaCast' },
    linux: { executableName: 'lumacast', debPackageName: 'lumacast' },
  },
  {
    id: 'flux',
    productName: 'Lumaflux',
    bundleId: 'app.lumaflux.desktop',
    summary: 'Photo editing with agent automation',
    versionScheme: 'semver-revision',
    releaseTagPrefix: 'flux-v',
    legacyTagPrefix: null,
    feedTag: 'flux-feed',
    mac: { bundleName: 'Lumaflux.app' },
    win: { executableName: 'Lumaflux.exe', displayName: 'Lumaflux' },
    linux: { executableName: 'lumaflux', debPackageName: 'lumaflux' },
  },
  {
    id: 'cloud',
    productName: 'LumaCloud',
    bundleId: 'com.lumacast.cloud',
    summary: 'Installs and updates the suite',
    versionScheme: 'semver',
    releaseTagPrefix: 'cloud-v',
    legacyTagPrefix: null,
    feedTag: 'cloud-feed',
    mac: { bundleName: 'LumaCloud.app' },
    win: { executableName: 'LumaCloud.exe', displayName: 'LumaCloud' },
    linux: { executableName: 'lumacloud', debPackageName: 'lumacloud' },
  },
]);

export const SUITE_APP_IDS: readonly SuiteAppId[] = Object.freeze(SUITE_APPS.map((app) => app.id));

export function suiteApp(id: SuiteAppId): SuiteAppDescriptor {
  const app = SUITE_APPS.find((candidate) => candidate.id === id);
  if (!app) {
    throw new Error(`Unknown suite app "${id}"; expected one of ${SUITE_APP_IDS.join(', ')}.`);
  }
  return app;
}

export function isSuiteAppId(value: unknown): value is SuiteAppId {
  return typeof value === 'string' && (SUITE_APP_IDS as readonly string[]).includes(value);
}

const MANAGED_PREFIX = `${SUITE_ORGANIZATION}.`;

/**
 * True when `bundleId` is a `com.lumacast.<segment>` identity (the bare
 * organization id `com.lumacast` does not qualify — it names no app) or one
 * of the pre-monorepo identities in `LEGACY_MANAGED_IDENTITIES`.
 */
export function isManagedIdentity(bundleId: string): boolean {
  if (LEGACY_MANAGED_IDENTITIES.has(bundleId)) return true;
  return bundleId.startsWith(MANAGED_PREFIX) && bundleId.length > MANAGED_PREFIX.length;
}
