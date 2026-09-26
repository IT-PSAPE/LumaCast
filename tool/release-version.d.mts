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

export function isReleaseApp(app: string): app is ReleaseApp;

export function assertReleaseApp(app: string): ReleaseApp;

export function parseStableVersion(version: string): [number, number, number];

export function compareStableVersions(left: string | number[], right: string | number[]): number;

export function highestPublishedVersionFor(app: string, publishedTags: readonly string[]): string | undefined;

export function releaseTagFor(app: string, version: string): string;

export function appManifestPath(app: string, rootDir?: string): string;

export function readManifestVersion(manifestPath: string): string;

export function decideStableRelease(input: StableReleaseInput): StableReleaseDecision;
