export type ReleaseApp = 'cast' | 'cloud' | 'flux';

export type PreviousVersionSource = 'app-manifest' | 'root-manifest';

export type StableReleaseReason =
  | 'tag-exists'
  | 'manual-ci-only'
  | 'unsupported-event'
  | 'no-baseline-version'
  | 'version-unchanged'
  | 'version-increased';

export interface StableReleaseInput {
  app: ReleaseApp | string;
  eventName: string;
  currentVersion: string;
  previousVersion?: string;
  previousVersionSource?: PreviousVersionSource | string;
  tagExists: boolean;
  highestPublishedVersion?: string;
}

export interface StableReleaseDecision {
  shouldRelease: boolean;
  reason: StableReleaseReason;
}

export const RELEASE_APPS: readonly ReleaseApp[];

export const PREVIOUS_VERSION_SOURCES: readonly PreviousVersionSource[];

/** Apps whose versions may carry a numeric `+<revision>` build revision. */
export const BUILD_REVISION_APPS: readonly ReleaseApp[];

export function isReleaseApp(app: string): app is ReleaseApp;

export function assertReleaseApp(app: string): ReleaseApp;

/**
 * `app` is optional and defaults to the strict plain-SemVer reading; only an
 * app in {@link BUILD_REVISION_APPS} accepts a trailing `+<number>`, which is
 * returned as a fourth component.
 */
export function parseStableVersion(version: string, app?: string): number[];

export function compareStableVersions(left: string | number[], right: string | number[], app?: string): number;

export function allowsBuildRevision(app: string): boolean;

export function highestPublishedVersionFor(app: string, publishedTags: readonly string[]): string | undefined;

export function releaseTagFor(app: string, version: string): string;

export function appManifestPath(app: string, rootDir?: string): string;

export function readManifestVersion(manifestPath: string): string;

export function decideStableRelease(input: StableReleaseInput): StableReleaseDecision;
