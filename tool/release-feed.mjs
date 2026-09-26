#!/usr/bin/env node

// Generic update-feed tooling for the per-app release workflows.
//
// Each app publishes a permanent `<app>-feed` release that carries rewritten
// updater metadata only. `electron-builder` writes relative artifact names
// (`LumaCast-1.2.3-linux.AppImage`) that resolve against the directory the
// metadata was downloaded from; on a feed release that directory holds no
// installers, so every artifact reference is rewritten to an absolute URL on the
// immutable `<app>-v<version>` release. Checksums, sizes, and every other field
// are copied through untouched, so the rewritten metadata is byte-comparable to
// the metadata in the version release except for the URLs.
//
// The feed only ever moves forward: a rewrite requires a published version
// release, and a version lower than the one already served is refused. A
// partial upload that leaves channel files on two versions heals by
// republishing the known version release (same-version repair), never by
// downgrade.
//
// Versions are read with the same rules the release gate applies, so a Flux
// build revision (`0.11.0+1`) is a comparable version here and Cast and Cloud
// stay on strict plain SemVer. `app` is optional on every export and defaults
// to the strict reading.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import {
  assertReleaseApp,
  compareStableVersions,
  parseStableVersion,
} from './release-version.mjs';

const FEED_METADATA_FILE = /^latest.*\.yml$/;

export function feedTagFor(app) {
  return `${assertReleaseApp(app)}-feed`;
}

export function isFeedMetadataFile(fileName) {
  return FEED_METADATA_FILE.test(fileName);
}

function describe(source) {
  return typeof source === 'string' && source.length > 0 ? source : 'update metadata';
}

export function parseUpdateMetadata(text, source = 'update metadata', app) {
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (error) {
    throw new Error(`${describe(source)} is not valid YAML: ${error.message}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${describe(source)} must be a YAML mapping.`);
  }
  if (typeof parsed.version !== 'string') {
    throw new Error(`${describe(source)} declares no version.`);
  }
  parseStableVersion(parsed.version, app);
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error(`${describe(source)} declares no files.`);
  }
  return parsed;
}

export function normalizeDownloadBase(downloadBaseUrl) {
  if (typeof downloadBaseUrl !== 'string' || downloadBaseUrl.trim().length === 0) {
    throw new Error('A download base URL is required to rewrite update metadata.');
  }

  let url;
  try {
    url = new URL(downloadBaseUrl);
  } catch {
    throw new Error(`Download base URL "${downloadBaseUrl}" must be an absolute URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Download base URL "${downloadBaseUrl}" must use http or https.`);
  }
  return url.href.replace(/\/+$/, '');
}

function absoluteArtifactUrl(downloadBase, reference, { source, field }) {
  if (typeof reference !== 'string' || reference.trim().length === 0) {
    throw new Error(`${describe(source)} has an empty ${field} artifact reference.`);
  }

  // Only the file name is meaningful: a feed release serves metadata, and the
  // artifact itself always lives in the immutable version release.
  const name = reference.split('/').filter((segment) => segment.length > 0).pop();
  if (!name || name === '.' || name === '..') {
    throw new Error(`${describe(source)} has an unusable ${field} artifact reference "${reference}".`);
  }

  return new URL(encodeURIComponent(name), `${downloadBase}/`).href;
}

/**
 * @param {{
 *   text: string;
 *   downloadBaseUrl: string;
 *   source?: string;
 *   app?: string;
 * }} input
 */
export function rewriteUpdateMetadata({ text, downloadBaseUrl, source = 'update metadata', app }) {
  const downloadBase = normalizeDownloadBase(downloadBaseUrl);
  const parsed = parseUpdateMetadata(text, source, app);
  const label = describe(source);

  const files = parsed.files.map((file, index) => {
    if (file === null || typeof file !== 'object' || Array.isArray(file)) {
      throw new Error(`${label} files[${index}] must be a mapping.`);
    }
    return {
      ...file,
      url: absoluteArtifactUrl(downloadBase, file.url, { source: label, field: `files[${index}].url` }),
    };
  });

  const rewritten = { ...parsed, files };

  if (typeof rewritten.path === 'string') {
    rewritten.path = absoluteArtifactUrl(downloadBase, rewritten.path, { source: label, field: 'path' });
  }

  if (rewritten.packages !== undefined && rewritten.packages !== null) {
    if (typeof rewritten.packages !== 'object' || Array.isArray(rewritten.packages)) {
      throw new Error(`${label} packages must be a mapping of architecture to package info.`);
    }
    rewritten.packages = Object.fromEntries(
      Object.entries(rewritten.packages).map(([arch, info]) => {
        if (info === null || typeof info !== 'object' || Array.isArray(info)) {
          throw new Error(`${label} packages.${arch} must be a mapping.`);
        }
        return [arch, {
          ...info,
          path: absoluteArtifactUrl(downloadBase, info.path, { source: label, field: `packages.${arch}.path` }),
        }];
      }),
    );
  }

  if (rewritten.releaseDate instanceof Date) {
    rewritten.releaseDate = rewritten.releaseDate.toISOString();
  }

  const artifacts = [
    ...files.map((file) => file.url),
    ...(typeof rewritten.path === 'string' ? [rewritten.path] : []),
    ...Object.values(rewritten.packages ?? {}).map((info) => info.path),
  ];

  return {
    text: yaml.dump(rewritten, { lineWidth: -1, noRefs: true, sortKeys: false }),
    version: parsed.version,
    artifacts,
  };
}

export function readFeedVersions(directory, app) {
  if (!directory || !fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory)
    .filter(isFeedMetadataFile)
    .sort()
    .map((fileName) =>
      parseUpdateMetadata(
        fs.readFileSync(path.join(directory, fileName), 'utf8'),
        `feed metadata ${fileName}`,
        app,
      ).version);
}

function assertConsistentFeedVersions(versions, incomingVersion, app) {
  const unique = [...new Set(versions)];
  if (unique.length <= 1) {
    return { version: unique[0], inconsistent: false };
  }

  // A partial feed upload can leave channel files on two different versions.
  // Rerunning the same version release must heal that split instead of
  // throwing forever, but it must never roll the feed back: only an incoming
  // version at or ahead of the highest served version may repair the feed.
  let max = unique[0];
  for (const candidate of unique.slice(1)) {
    if (compareStableVersions(candidate, max, app) > 0) {
      max = candidate;
    }
  }
  const incoming = parseStableVersion(incomingVersion, app);
  if (compareStableVersions(incoming, parseStableVersion(max, app), app) < 0) {
    throw new Error(
      `Feed metadata versions disagree (${unique.join(', ')}) and incoming ${incomingVersion} is older than ${max}; refusing to roll the feed back.`,
    );
  }
  return { version: max, inconsistent: true };
}

/**
 * @param {{
 *   app: string;
 *   incomingVersion: string;
 *   currentFeedVersion?: string;
 *   releasePublished: boolean;
 *   feedInconsistent?: boolean;
 * }} input
 */
export function decideFeedUpdate({ app, incomingVersion, currentFeedVersion, releasePublished, feedInconsistent = false }) {
  const feedTag = feedTagFor(app);
  const incoming = parseStableVersion(incomingVersion, app);
  const decision = { feedTag, incomingVersion, feedVersion: currentFeedVersion ?? '' };

  if (!releasePublished) {
    return { ...decision, shouldUpdate: false, reason: 'release-not-published' };
  }
  if (!currentFeedVersion) {
    return { ...decision, shouldUpdate: true, reason: 'feed-empty' };
  }

  const comparison = compareStableVersions(incoming, parseStableVersion(currentFeedVersion, app), app);
  if (comparison < 0) {
    throw new Error(
      `Feed ${feedTag} already serves ${currentFeedVersion}; refusing to roll it back to ${incomingVersion}.`,
    );
  }
  if (comparison === 0) {
    // A split feed (partial upload) heals by republishing the same version.
    if (feedInconsistent) {
      return { ...decision, shouldUpdate: true, reason: 'feed-repair' };
    }
    return { ...decision, shouldUpdate: false, reason: 'feed-already-current' };
  }
  return { ...decision, shouldUpdate: true, reason: 'feed-version-increased' };
}

function runRewriteCommand() {
  const app = assertReleaseApp(process.env.RELEASE_APP ?? '');
  const metadataFile = process.env.METADATA_FILE ?? '';
  if (metadataFile.length === 0) {
    throw new Error('METADATA_FILE must point at the updater metadata to rewrite.');
  }

  const result = rewriteUpdateMetadata({
    text: fs.readFileSync(metadataFile, 'utf8'),
    downloadBaseUrl: process.env.DOWNLOAD_BASE_URL ?? '',
    source: `update metadata ${path.basename(metadataFile)}`,
    app,
  });

  const outputFile = process.env.OUTPUT_FILE ?? '';
  if (outputFile.length > 0) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, result.text);
    process.stderr.write(
      `release-feed: ${app} feed metadata for ${result.version} -> ${result.artifacts.length} artifact URLs\n`,
    );
    return;
  }

  process.stdout.write(result.text);
}

function runGuardCommand() {
  const app = assertReleaseApp(process.env.RELEASE_APP ?? '');
  const releasePublished = process.env.RELEASE_PUBLISHED === 'true';
  const incomingVersion = process.env.INCOMING_VERSION ?? '';

  // The feed directory is only read once the version release is known to be
  // published: an unpublished release may have no feed at all yet.
  const feedVersions = releasePublished
    ? readFeedVersions(process.env.FEED_METADATA_DIR ?? '', app)
    : [];
  const resolved = assertConsistentFeedVersions(feedVersions, incomingVersion, app);
  const currentFeedVersion = resolved.version;

  const decision = decideFeedUpdate({
    app,
    incomingVersion,
    currentFeedVersion,
    releasePublished,
    feedInconsistent: resolved.inconsistent,
  });

  process.stdout.write([
    `should_update=${decision.shouldUpdate}`,
    `reason=${decision.reason}`,
    `feed_tag=${decision.feedTag}`,
    `feed_version=${decision.feedVersion}`,
    `incoming_version=${decision.incomingVersion}`,
    '',
  ].join('\n'));
}

const COMMANDS = {
  rewrite: runRewriteCommand,
  guard: runGuardCommand,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2] ?? '';
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`release-feed: unknown command "${command}"; expected ${Object.keys(COMMANDS).join(' or ')}.\n`);
    process.exitCode = 1;
  } else {
    try {
      handler();
    } catch (error) {
      process.stderr.write(`release-feed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
