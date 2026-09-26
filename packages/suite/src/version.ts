// Version parsing and comparison, mirroring tool/release-version.mjs exactly
// (the release gate is the authority on what a valid app version is; this
// module is the renderer-safe reading of the same rule, so Cloud judges an
// installed/published version identically to the CI gate that published it).
//
// `semver` is strict `major.minor.patch` (no prerelease, no build metadata).
// `semver-revision` additionally accepts a numeric build revision
// (`major.minor.patch+revision`), compared as a fourth component — Flux's
// scheme, so a rebuild of the same feature version can still be ordered.
import type { VersionScheme } from './types';

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REVISION_VERSION = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\+((?:0|[1-9]\d*))$/;

function isSafeRevision(revision: string): boolean {
  return Number.isSafeInteger(Number(revision));
}

function schemeError(version: string, scheme: VersionScheme): Error {
  const revision = scheme === 'semver-revision'
    ? '; a numeric build revision is also accepted (major.minor.patch+<number>)'
    : '';
  return new Error(
    `Version "${version}" must be a stable semantic version (major.minor.patch, no prerelease or build metadata)${revision}.`,
  );
}

/**
 * Validate `version` under `scheme` and return its numeric components
 * (`[major, minor, patch]`, or `[major, minor, patch, revision]` under
 * `semver-revision`), or throw a descriptive error.
 */
export function parseVersion(version: string, scheme: VersionScheme = 'semver'): number[] {
  if (STABLE_VERSION.test(version)) {
    return version.split('.').map(Number);
  }
  if (scheme === 'semver-revision') {
    const match = REVISION_VERSION.exec(version);
    if (match) {
      // A revision that cannot be compared exactly is a build-identity bug,
      // not a version: refuse it rather than accept an unreproducible order.
      if (!isSafeRevision(match[2])) {
        throw new Error(
          `Version "${version}" has a build revision beyond the exactly comparable range (${Number.MAX_SAFE_INTEGER}).`,
        );
      }
      return [...match[1].split('.').map(Number), Number(match[2])];
    }
  }
  throw schemeError(version, scheme);
}

export function isValidVersion(version: string, scheme: VersionScheme = 'semver'): boolean {
  try {
    parseVersion(version, scheme);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compare two versions under `scheme`. A version without a revision is the
 * base revision, so a missing fourth component compares as 0 and `0.11.0`
 * sorts below `0.11.0+1`.
 */
export function compareVersions(a: string, b: string, scheme: VersionScheme = 'semver'): number {
  const left = parseVersion(a, scheme);
  const right = parseVersion(b, scheme);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftComponent = left[index] ?? 0;
    const rightComponent = right[index] ?? 0;
    if (leftComponent !== rightComponent) return leftComponent - rightComponent;
  }
  return 0;
}
