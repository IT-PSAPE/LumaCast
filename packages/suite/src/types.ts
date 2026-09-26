// The LumaCast suite model. Every type here is plain data: it crosses the
// Cloud IPC boundary unchanged and is rendered by the Cloud UI, so nothing in
// this file may name Node, Electron, or a platform API.

/** The workspace id of a managed app (`apps/<id>`). */
export type SuiteAppId = 'cast' | 'cloud' | 'flux' | 'chord';

export type HostPlatform = 'darwin' | 'win32' | 'linux';
export type HostArch = 'x64' | 'arm64';

/**
 * How an app's manifest version is read. `semver` is strict
 * `major.minor.patch`; `semver-revision` additionally accepts a numeric build
 * revision (`0.11.0+1`) compared as a fourth component. Mirrors
 * tool/release-version.mjs, which is the release gate's authority.
 */
export type VersionScheme = 'semver' | 'semver-revision';

export interface SuiteAppDescriptor {
  id: SuiteAppId;
  /** Product name as electron-builder writes it into artifact names. */
  productName: string;
  /** Bundle identifier / AppUserModelID. Must be a managed identity. */
  bundleId: string;
  /** One-line description shown on the app card. */
  summary: string;
  versionScheme: VersionScheme;
  /** `<app>-v` — the per-app release tag prefix (ADR-0043). */
  releaseTagPrefix: string;
  /**
   * The tag prefix of releases published before the per-app pipeline. Only
   * Cast has one (`v`); its legacy releases still carry installers and
   * updater metadata and remain installable.
   */
  legacyTagPrefix: string | null;
  /** The permanent `<app>-feed` release tag. */
  feedTag: string;
  mac: {
    /** `LumaCast.app` */
    bundleName: string;
  };
  win: {
    /** The installed executable file name, e.g. `LumaCast.exe`. */
    executableName: string;
    /** The NSIS uninstall registry DisplayName. */
    displayName: string;
  };
  linux: {
    /** The AppImage/deb executable, e.g. `lumacast`. */
    executableName: string;
    debPackageName: string;
  };
}

/** A GitHub release as the REST API returns it, reduced to what Cloud reads. */
export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

/** One installable version of one app, derived from a GitHub release. */
export interface AppRelease {
  app: SuiteAppId;
  version: string;
  tag: string;
  /** True when the tag uses the pre-ADR-0043 `v<version>` form. */
  legacy: boolean;
  publishedAt: string | null;
  notesUrl: string;
  assets: GitHubReleaseAsset[];
}

/** electron-builder's `latest*.yml`, the subset the installer trusts. */
export interface UpdateMetadataFile {
  url: string;
  sha512: string;
  size: number;
}

export interface UpdateMetadata {
  version: string;
  files: UpdateMetadataFile[];
  path: string;
  sha512: string;
  releaseDate: string | null;
}

export type InstallerKind = 'mac-zip' | 'mac-dmg' | 'win-nsis' | 'linux-appimage' | 'linux-deb';

/** The one artifact Cloud downloads for a given host. */
export interface InstallArtifact {
  kind: InstallerKind;
  name: string;
  url: string;
  sha512: string;
  size: number;
}

export type AppStatus =
  | 'not-installed'
  | 'up-to-date'
  | 'update-available'
  /** Installed version is newer than anything published (a local build). */
  | 'ahead'
  /** Installed, but the catalog has not loaded. */
  | 'unknown';

/** What the host found on disk for one app. */
export interface InstalledApp {
  app: SuiteAppId;
  version: string;
  /** Bundle path (mac), install directory (win), or AppImage/binary (linux). */
  location: string;
  /** Where the install came from, when Cloud can tell. */
  scope: 'user' | 'system' | 'unknown';
}

export interface AppState {
  app: SuiteAppId;
  status: AppStatus;
  installed: InstalledApp | null;
  latest: AppRelease | null;
  /** Newest first. */
  releases: AppRelease[];
}
