#!/usr/bin/env node

// Stable-release gate for the per-app release workflows. The workflow resolves
// the baseline version; this module owns the release semantics:
//
// - only a push may release, and only when the app manifest version is a stable
//   semantic version that is strictly greater than the baseline;
// - a manual dispatch is CI-only unless the operator explicitly requests a
//   release; a requested manual release needs no baseline (the request is the
//   intent) but still refuses an already published or older version;
// - a missing baseline never auto-releases, so the commit that introduces an app
//   manifest (or the repository-to-apps migration) cannot publish by accident;
// - an already published <app>-v<version> release makes a rerun a no-op;
// - the current version must also exceed the highest already published
//   <app>-v<version> release, so a delayed or reverted push cannot hand the
//   Cast latest slot (or any feed) to an old version.
//
// Version tags are prefixed per app (`cast-v1.2.3`) because Cast, Cloud, Flux,
// and Chord release independently from one repository.
//
// Flux versions may carry a numeric build revision (`0.11.0+1`), which the
// release gate compares as a fourth component so a rebuild of the same
// feature version can ship. Cast and Cloud stay on strict plain SemVer: the
// revision form is rejected for them, and the metadata form of a version
// (prerelease or non-numeric build metadata) is rejected everywhere. The app
// argument is optional on every exported helper and defaults to the strict
// plain-SemVer reading, so an app-unaware caller can never accept a revision.
//
// Flux additionally caps every version component — major, minor, patch, and the
// revision — at 65535, because those components become the four 16-bit fields of
// the Windows `buildVersion`. A component above 65535 cannot be represented, so
// it is not a Flux version at all: the gate refuses it up front rather than
// letting the build fail after an upload. The cap applies to a plain Flux
// feature version exactly as it does to a revisioned one, because the Windows
// build reads the same four fields either way. Cast and Cloud are untouched.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const REVISION_VERSION = /^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\+((?:0|[1-9]\d*))$/;

export const RELEASE_APPS = Object.freeze(['cast', 'cloud', 'flux', 'chord']);

export const PREVIOUS_VERSION_SOURCES = Object.freeze(['app-manifest', 'root-manifest']);

// Only these apps publish a build revision. Keeping the set explicit means a
// new app starts on strict plain SemVer and opts in deliberately.
export const BUILD_REVISION_APPS = Object.freeze(['flux']);

// Apps whose version components must fit the 16-bit fields of the Windows
// `buildVersion`. Flux inherits the cap from the release pipeline it came from;
// keeping the set explicit means a new app opts in deliberately.
const BUILD_COMPONENT_BOUND_APPS = Object.freeze(['flux']);

const MAX_BUILD_COMPONENT = 65535;

export function isReleaseApp(app) {
  return RELEASE_APPS.includes(app);
}

export function assertReleaseApp(app) {
  if (!isReleaseApp(app)) {
    throw new Error(`Unknown release app "${app}"; expected one of ${RELEASE_APPS.join(', ')}.`);
  }
  return app;
}

export function allowsBuildRevision(app) {
  return BUILD_REVISION_APPS.includes(app);
}

function boundsBuildComponents(app) {
  return BUILD_COMPONENT_BOUND_APPS.includes(app);
}

function isSafeRevision(revision) {
  return Number.isSafeInteger(Number(revision));
}

function isWithinBuildComponentBounds(app, components) {
  if (!boundsBuildComponents(app)) return true;
  return components.every((component) => component <= MAX_BUILD_COMPONENT);
}

function buildComponentBoundsError(app, version) {
  return new Error(
    `Release version "${version}" has a component above ${MAX_BUILD_COMPONENT}; `
      + `every ${app} major, minor, patch, and revision component must be between 0 and ${MAX_BUILD_COMPONENT} `
      + 'to form the Windows buildVersion.',
  );
}

/**
 * Validate `version` for `app` and return its numeric components, or throw the
 * reason it is not a release version. Shared by the release gate (which reports
 * the failure) and by the published-tag scan (which skips the tag).
 */
function parseVersionComponents(app, version) {
  if (typeof version === 'string') {
    if (STABLE_VERSION.test(version)) {
      const components = version.split('.').map(Number);
      if (!isWithinBuildComponentBounds(app, components)) {
        throw buildComponentBoundsError(app, version);
      }
      return components;
    }
    const revision = REVISION_VERSION.exec(version);
    if (revision && allowsBuildRevision(app)) {
      // A revision that cannot be compared exactly is a build-identity bug, not
      // a release: refuse it rather than release an unreproducible order.
      if (!isSafeRevision(revision[2])) {
        throw new Error(
          `Release version "${version}" has a build revision beyond the exactly comparable range (${Number.MAX_SAFE_INTEGER}).`,
        );
      }
      const components = [...revision[1].split('.').map(Number), Number(revision[2])];
      if (!isWithinBuildComponentBounds(app, components)) {
        throw buildComponentBoundsError(app, version);
      }
      return components;
    }
  }
  throw versionError(version, app);
}

function isReleaseVersionFor(app, version) {
  try {
    parseVersionComponents(app, version);
    return true;
  } catch {
    // A tag that is not a release version for this app is skipped rather than
    // thrown: the published set is external input, and one unbuildable tag must
    // not fail the scan for every other tag.
    return false;
  }
}

function versionError(version, app) {
  const revision = allowsBuildRevision(app)
    ? `; ${app} additionally accepts a numeric build revision (major.minor.patch+<number>)`
    : '';
  return new Error(
    `Release version "${version}" must be a stable semantic version (major.minor.patch, no prerelease or build metadata)${revision}.`,
  );
}

/**
 * @param {string} version
 * @param {string} [app] Release app; when it accepts a build revision, a
 * trailing `+<number>` is returned as a fourth component.
 * @returns {number[]}
 */
export function parseStableVersion(version, app) {
  return parseVersionComponents(app, version);
}

/**
 * @param {string|number[]} left
 * @param {string|number[]} right
 * @param {string} [app]
 */
export function compareStableVersions(left, right, app) {
  const a = Array.isArray(left) ? left : parseStableVersion(left, app);
  const b = Array.isArray(right) ? right : parseStableVersion(right, app);
  // A version without a revision is the base revision, so a missing component
  // compares as 0 and `0.11.0` sorts below `0.11.0+1`.
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const left_ = a[index] ?? 0;
    const right_ = b[index] ?? 0;
    if (left_ !== right_) return left_ - right_;
  }
  return 0;
}

export function highestPublishedVersionFor(app, publishedTags) {
  const prefix = `${assertReleaseApp(app)}-v`;
  let highest;
  for (const tag of publishedTags) {
    if (typeof tag !== 'string' || !tag.startsWith(prefix)) continue;
    const version = tag.slice(prefix.length);
    if (!isReleaseVersionFor(app, version)) continue;
    if (highest === undefined || compareStableVersions(version, highest, app) > 0) {
      highest = version;
    }
  }
  return highest;
}

export function releaseTagFor(app, version) {
  return `${assertReleaseApp(app)}-v${version}`;
}

export function appManifestPath(app, rootDir = process.cwd()) {
  return path.join(rootDir, 'apps', assertReleaseApp(app), 'package.json');
}

export function readManifestVersion(manifestPath) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error(`App manifest ${manifestPath} is unreadable; it owns the release version.`);
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new Error(`App manifest ${manifestPath} is not valid JSON: ${error.message}`);
  }

  const version = manifest?.version;
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`App manifest ${manifestPath} declares no version; the release gate cannot read one.`);
  }
  return version;
}

/**
 * @param {{
 *   app: string;
 *   eventName: string;
 *   currentVersion: string;
 *   previousVersion?: string;
 *   previousVersionSource?: string;
 *   tagExists: boolean;
 *   highestPublishedVersion?: string;
 *   releaseRequested?: boolean;
 * }} input
 */
export function decideStableRelease(input) {
  assertReleaseApp(input.app);
  const app = input.app;
  const current = parseStableVersion(input.currentVersion, app);

  const source = input.previousVersionSource;
  if (source !== undefined && !PREVIOUS_VERSION_SOURCES.includes(source)) {
    throw new Error(`Unknown previous version source "${source}"; expected one of ${PREVIOUS_VERSION_SOURCES.join(', ')}.`);
  }
  if (source !== undefined && !input.previousVersion) {
    throw new Error(`Previous version source "${source}" requires a baseline version.`);
  }
  if (input.previousVersion && !source) {
    throw new Error('A baseline version requires a previous version source.');
  }

  const manual = input.eventName === 'workflow_dispatch';
  if (manual && input.releaseRequested !== true) {
    return { shouldRelease: false, reason: 'manual-ci-only' };
  }
  if (!manual && input.eventName !== 'push') {
    return { shouldRelease: false, reason: 'unsupported-event' };
  }

  // The baseline proves a stable increase within this push, but a delayed or
  // reverted push can still be older than the highest already published
  // <app>-v<version> release. Releasing it would hand Cast's latest slot (and
  // the feed) to an old version, so it must fail instead — even when the tag
  // already exists, the baseline is missing, or the baseline is unchanged.
  // An already published current version is not rebuilt; the feed job heals it.
  if (input.highestPublishedVersion) {
    const highest = parseStableVersion(input.highestPublishedVersion, app);
    const againstHighest = compareStableVersions(current, highest, app);
    if (againstHighest < 0) {
      throw new Error(
        `Release version ${input.currentVersion} must be greater than highest published ${input.highestPublishedVersion} for ${input.app}.`,
      );
    }
    if (againstHighest === 0) {
      return { shouldRelease: false, reason: 'tag-exists' };
    }
  }

  if (input.tagExists) {
    return { shouldRelease: false, reason: 'tag-exists' };
  }
  // A requested manual release ships the current manifest version as long as
  // it is unpublished and newer than every published release (checked above);
  // it does not need a baseline increase within the run.
  if (manual) {
    return { shouldRelease: true, reason: 'manual-release' };
  }
  if (!input.previousVersion) {
    return { shouldRelease: false, reason: 'no-baseline-version' };
  }

  const comparison = compareStableVersions(current, parseStableVersion(input.previousVersion, app), app);
  if (comparison < 0) {
    throw new Error(`Release version ${input.currentVersion} must be greater than baseline ${input.previousVersion}.`);
  }
  if (comparison === 0) {
    return { shouldRelease: false, reason: 'version-unchanged' };
  }

  return { shouldRelease: true, reason: 'version-increased' };
}

function runCommandInterface() {
  const app = assertReleaseApp(process.env.RELEASE_APP ?? '');
  const manifest = process.env.APP_MANIFEST || appManifestPath(app);
  const currentVersion = readManifestVersion(manifest);
  const previousVersion = process.env.PREVIOUS_VERSION || undefined;
  const previousVersionSource = process.env.PREVIOUS_VERSION_SOURCE || undefined;
  const tagExists = process.env.TAG_EXISTS === 'true';
  const highestPublishedVersion = process.env.HIGHEST_PUBLISHED_VERSION || undefined;
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const releaseRequested = process.env.RELEASE_REQUESTED === 'true';

  const decision = decideStableRelease({
    app,
    eventName,
    currentVersion,
    previousVersion,
    previousVersionSource,
    tagExists,
    highestPublishedVersion,
    releaseRequested,
  });

  process.stdout.write([
    `app=${app}`,
    `version=${currentVersion}`,
    `tag=${releaseTagFor(app, currentVersion)}`,
    `should_release=${decision.shouldRelease}`,
    `reason=${decision.reason}`,
    `previous_version=${previousVersion ?? ''}`,
    `previous_version_source=${previousVersionSource ?? ''}`,
    '',
  ].join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCommandInterface();
  } catch (error) {
    process.stderr.write(`release-version: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
