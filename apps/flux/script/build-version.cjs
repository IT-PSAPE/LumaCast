// Restores the release version and derives the packaged build number from the
// app manifest, at pack time.
//
// The manifest is the only place a release version is written: `0.11.0+1`
// names the feature version plus a numeric build revision, exactly what the
// release gate (`tool/release-version.mjs`) tags and compares. Two
// electron-builder behaviours would otherwise lose that:
//
// 1. `normalizePackageData` runs `semver.clean` over the manifest version
//    (`app-builder-lib/out/util/normalizePackageData.js`), so the metadata
//    electron-builder packs and reports starts at `0.11.0` with the revision
//    gone. Every `AppInfo` reads `info.metadata.version` for its `version`, so
//    `AppInfo.version`, the `${version}` artifact names, and the generated
//    `latest-mac.yml` feed all said `0.11.0` while the gate tagged
//    `flux-v0.11.0+1`. The single-package release config this app came from
//    papered over it with `extraMetadata.version`, which is applied to the
//    shared metadata; this hook does the equivalent at pack time, derived
//    from the manifest rather than hardcoded.
// 2. CFBundleVersion / FileVersion is a four-component, plain-integer number,
//    so it cannot be the manifest string and cannot be a constant in the
//    builder config either — a hardcoded `0.11.0.1` silently ships the wrong
//    number the moment the manifest moves to `0.12.0+1`. This hook therefore
//    derives it and writes it onto the effective config and the
//    already-constructed AppInfo objects, which every platform packer reads
//    after `beforePack`.
//
// CFBundleShortVersionString must stay the Apple-shaped feature version, so the
// mac packer's `bundleShortVersion` is pinned to the feature version rather
// than inheriting the revisioned `AppInfo.version`. Windows instead reads
// `ProductVersion` from `appInfo.shortVersionWindows`, which
// app-builder-lib's winPackager takes or falls back to
// `getVersionInWeirdWindowsForm(appInfo.version)` — and that loses the revision
// (0.11.0+1 becomes 0.11.0.0), so `ProductVersion` and `FileVersion` disagree
// unless `shortVersionWindows` is the same four-component number. Only that
// field is set: `buildNumber` is what the Linux deb iteration counts, so it
// must stay exactly as electron-builder derived it.
const fs = require('node:fs');
const path = require('node:path');

// Windows stores the build number as four 16-bit fields, so no component can
// exceed this; a manifest component above it is not a buildable version.
const MAX_BUILD_COMPONENT = 65535;

// major.minor.patch with an optional numeric build revision. Prerelease tags and
// non-numeric build metadata are rejected: they cannot be expressed as a
// four-component build number.
const MANIFEST_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+(0|[1-9]\d*))?$/;

/**
 * @param {string} version A manifest `version`, e.g. `0.11.0+1` or `0.11.0`.
 * @returns {{ featureVersion: string, releaseVersion: string, buildVersion: string, revision: number }}
 */
function deriveBuildVersion(version) {
  const match = MANIFEST_VERSION.exec(typeof version === 'string' ? version.trim() : '');
  if (match == null) {
    throw new Error(
      `Lumaflux version ${JSON.stringify(version)} is not major.minor.patch with an optional numeric `
        + 'build revision (0.11.0 or 0.11.0+1), so no four-component build number can be derived from it.',
    );
  }

  const [major, minor, patch, revision] = match.slice(1, 5).map((component) => Number(component ?? 0));
  const components = [major, minor, patch, revision];
  for (const component of components) {
    if (!Number.isInteger(component) || component < 0 || component > MAX_BUILD_COMPONENT) {
      throw new Error(
        `Lumaflux version ${version} has a component above ${MAX_BUILD_COMPONENT}; every major, minor, `
          + 'patch, and revision component must be between 0 and 65535 to form the build number.',
      );
    }
  }

  const featureVersion = `${major}.${minor}.${patch}`;
  return {
    featureVersion,
    // The manifest version as electron-builder has to see it: the revisioned
    // string the release gate compares, or the plain feature version when the
    // manifest carries no revision at all.
    releaseVersion: match[4] === undefined ? featureVersion : `${featureVersion}+${revision}`,
    buildVersion: components.join('.'),
    revision,
  };
}

/**
 * The `beforePack` context carries the *platform* packager, so the root
 * `Packager` (its shared config, shared metadata, and root `AppInfo`) is
 * reached through `info`. Fall back to the packager itself so a caller that
 * passes the root packager directly still works.
 *
 * @param {any} packager
 * @returns {any}
 */
function rootPackagerOf(packager) {
 return packager.info ?? packager;
}

/**
 * `macPackager` resolves `CFBundleShortVersionString` from its own
 * `bundleShortVersion` option; every other platform packer has no such option.
 *
 * @param {any} packager
 * @returns {boolean}
 */
function isMacPackager(packager) {
  const platform = packager?.platform;
  return platform?.buildConfigurationKey === 'mac' || platform?.nodeName === 'darwin';
}

/**
 * electron-builder `beforePack` hook.
 *
 * @param {{ packager: any }} context
 */
async function beforePack(context) {
  const packager = context.packager;
  const rootPackager = rootPackagerOf(packager);
  const manifestPath = path.join(rootPackager.projectDir ?? packager.projectDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { featureVersion, releaseVersion, buildVersion } = deriveBuildVersion(manifest.version);

  // The effective config is what a later target or artifact name would re-read.
  const config = packager.config ?? rootPackager.config;
  if (config != null) {
    config.buildVersion = buildVersion;
  }

  // The shared metadata is the source every AppInfo reads its `version` from,
  // and the same object `extraMetadata` used to patch. Restoring it here also
  // covers any AppInfo constructed after this hook (a later platform).
  if (rootPackager.metadata != null && typeof rootPackager.metadata === 'object') {
    rootPackager.metadata.version = releaseVersion;
  }

  // The platform AppInfo and the root AppInfo are already built, and artifact
  // names, the update-info feed, and every platform packer read `version` and
  // `buildVersion` off them long after this hook returns.
  for (const appInfo of new Set([packager.appInfo, rootPackager.appInfo])) {
    if (appInfo == null) continue;
    appInfo.version = releaseVersion;
    appInfo.buildVersion = buildVersion;
    appInfo.shortVersionWindows = buildVersion;
  }

  // CFBundleShortVersionString is a three-integer marketing version; it must
  // not carry `+revision`. An explicitly configured bundleShortVersion wins.
  const platformOptions = packager.platformSpecificBuildOptions;
  if (isMacPackager(packager) && platformOptions != null && typeof platformOptions === 'object') {
    if (platformOptions.bundleShortVersion == null) {
      platformOptions.bundleShortVersion = featureVersion;
    }
  }
}

// Exported as the hook function itself (electron-builder imports the module
// default when no `beforePack` named export exists) and re-exports the pure
// derivation so it is testable without running a build.
module.exports = beforePack;
module.exports.deriveBuildVersion = deriveBuildVersion;
module.exports.beforePack = beforePack;
module.exports.MAX_BUILD_COMPONENT = MAX_BUILD_COMPONENT;
