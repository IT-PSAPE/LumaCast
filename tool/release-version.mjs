#!/usr/bin/env node

// Stable-release gate for the per-app release workflows. The workflow resolves
// the baseline version; this module owns the release semantics:
//
// - only a push may release, and only when the app manifest version is a stable
//   semantic version that is strictly greater than the baseline;
// - a manual dispatch is CI-only and never packages;
// - a missing baseline never auto-releases, so the commit that introduces an app
//   manifest (or the repository-to-apps migration) cannot publish by accident;
// - an already published <app>-v<version> release makes a rerun a no-op;
// - the current version must also exceed the highest already published
//   <app>-v<version> release, so a delayed or reverted push cannot hand the
//   Cast latest slot (or any feed) to an old version.
//
// Version tags are prefixed per app (`cast-v1.2.3`) because Cast, Cloud, and
// Flux release independently from one repository.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const RELEASE_APPS = Object.freeze(['cast', 'cloud', 'flux']);

export const PREVIOUS_VERSION_SOURCES = Object.freeze(['app-manifest', 'root-manifest']);

export function isReleaseApp(app) {
  return RELEASE_APPS.includes(app);
}

export function assertReleaseApp(app) {
  if (!isReleaseApp(app)) {
    throw new Error(`Unknown release app "${app}"; expected one of ${RELEASE_APPS.join(', ')}.`);
  }
  return app;
}

export function parseStableVersion(version) {
  if (typeof version !== 'string' || !STABLE_VERSION.test(version)) {
    throw new Error(
      `Release version "${version}" must be a stable semantic version (major.minor.patch, no prerelease or build metadata).`,
    );
  }
  return version.split('.').map(Number);
}

export function compareStableVersions(left, right) {
  const a = Array.isArray(left) ? left : parseStableVersion(left);
  const b = Array.isArray(right) ? right : parseStableVersion(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function highestPublishedVersionFor(app, publishedTags) {
  const prefix = `${assertReleaseApp(app)}-v`;
  let highest;
  for (const tag of publishedTags) {
    if (typeof tag !== 'string' || !tag.startsWith(prefix)) continue;
    const version = tag.slice(prefix.length);
    if (!STABLE_VERSION.test(version)) continue;
    if (highest === undefined || compareStableVersions(version, highest) > 0) {
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
 * }} input
 */
export function decideStableRelease(input) {
  assertReleaseApp(input.app);
  const current = parseStableVersion(input.currentVersion);

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

  if (input.eventName === 'workflow_dispatch') {
    return { shouldRelease: false, reason: 'manual-ci-only' };
  }
  if (input.eventName !== 'push') {
    return { shouldRelease: false, reason: 'unsupported-event' };
  }

  // The baseline proves a stable increase within this push, but a delayed or
  // reverted push can still be older than the highest already published
  // <app>-v<version> release. Releasing it would hand Cast's latest slot (and
  // the feed) to an old version, so it must fail instead — even when the tag
  // already exists, the baseline is missing, or the baseline is unchanged.
  // An already published current version is not rebuilt; the feed job heals it.
  if (input.highestPublishedVersion) {
    const highest = parseStableVersion(input.highestPublishedVersion);
    const againstHighest = compareStableVersions(current, highest);
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
  if (!input.previousVersion) {
    return { shouldRelease: false, reason: 'no-baseline-version' };
  }

  const comparison = compareStableVersions(current, parseStableVersion(input.previousVersion));
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

  const decision = decideStableRelease({
    app,
    eventName,
    currentVersion,
    previousVersion,
    previousVersionSource,
    tagExists,
    highestPublishedVersion,
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
