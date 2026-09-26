// Parses the two inputs Cloud reads from GitHub: the release list (into the
// installable AppRelease catalog) and each release's electron-builder
// `latest*.yml` updater metadata.
import type {
  AppRelease,
  GitHubRelease,
  GitHubReleaseAsset,
  HostPlatform,
  SuiteAppDescriptor,
  UpdateMetadata,
  UpdateMetadataFile,
} from './types';
import { compareVersions, isValidVersion } from './version';

const METADATA_FILE_NAMES = new Set(['latest.yml', 'latest-mac.yml', 'latest-linux.yml']);

function hasUpdateMetadataAsset(assets: GitHubReleaseAsset[]): boolean {
  return assets.some((asset) => METADATA_FILE_NAMES.has(asset.name));
}

interface Candidate {
  version: string;
  tag: string;
  legacy: boolean;
  release: GitHubRelease;
}

function candidateFor(app: SuiteAppDescriptor, release: GitHubRelease): Candidate | null {
  if (release.draft) return null;
  if (release.prerelease) return null;
  if (release.tag_name === app.feedTag) return null;

  let version: string;
  let legacy: boolean;
  if (release.tag_name.startsWith(app.releaseTagPrefix)) {
    version = release.tag_name.slice(app.releaseTagPrefix.length);
    legacy = false;
  } else if (app.legacyTagPrefix !== null && release.tag_name.startsWith(app.legacyTagPrefix)) {
    version = release.tag_name.slice(app.legacyTagPrefix.length);
    legacy = true;
  } else {
    return null;
  }

  if (!isValidVersion(version, app.versionScheme)) return null;
  if (release.assets.length === 0) return null;
  if (!hasUpdateMetadataAsset(release.assets)) return null;

  return { version, tag: release.tag_name, legacy, release };
}

/**
 * Parse a GitHub release list into the installable catalog for `app`,
 * newest first. A legacy tag and a per-app tag for the same version both
 * resolve to one entry, preferring the per-app tag.
 */
export function parseReleaseCatalog(releases: GitHubRelease[], app: SuiteAppDescriptor): AppRelease[] {
  const byVersion = new Map<string, Candidate>();
  for (const release of releases) {
    const candidate = candidateFor(app, release);
    if (!candidate) continue;
    const existing = byVersion.get(candidate.version);
    if (!existing || (existing.legacy && !candidate.legacy)) {
      byVersion.set(candidate.version, candidate);
    }
  }

  return [...byVersion.values()]
    .sort((a, b) => compareVersions(b.version, a.version, app.versionScheme))
    .map((candidate) => ({
      app: app.id,
      version: candidate.version,
      tag: candidate.tag,
      legacy: candidate.legacy,
      publishedAt: candidate.release.published_at,
      notesUrl: candidate.release.html_url,
      assets: candidate.release.assets.map((asset) => ({
        name: asset.name,
        browser_download_url: asset.browser_download_url,
        size: asset.size,
      })),
    }));
}

export function updateMetadataFileNameFor(platform: HostPlatform): 'latest.yml' | 'latest-mac.yml' | 'latest-linux.yml' {
  switch (platform) {
    case 'darwin':
      return 'latest-mac.yml';
    case 'linux':
      return 'latest-linux.yml';
    case 'win32':
      return 'latest.yml';
    default: {
      const exhaustive: never = platform;
      throw new Error(`Unknown host platform: ${String(exhaustive)}`);
    }
  }
}

// --- latest*.yml parsing -----------------------------------------------
//
// electron-builder's `latest*.yml` is real YAML, but the subset it actually
// emits is fixed and small: a handful of top-level scalar keys and one
// `files` list of flat mappings. Rather than pull in a YAML library for
// three field names, this is a hand-written parser for exactly that subset:
//
//   version: 0.1.27
//   files:
//     - url: LumaCast-0.1.27-arm64-mac.zip
//       sha512: <base64>
//       size: 133019240
//   path: LumaCast-0.1.27-arm64-mac.zip
//   sha512: <base64>
//   releaseDate: '2026-09-20T07:16:55.381Z'
//
// Supported: 2-space indentation, `- ` list items (inline or with fields on
// following indented lines), single/double-quoted scalars, blank lines, and
// whole-line `#` comments. `blockMapSize` under a file entry is recognized
// and ignored (electron-builder's linux metadata carries it); any other
// unknown field is likewise ignored, for forward compatibility. Anything
// else (multi-line scalars, anchors, flow collections, inline comments) is
// out of scope and is not detected as invalid — it is simply not part of
// what electron-builder writes here.

interface RawFileEntry {
  url?: string;
  sha512?: string;
  size?: string;
}

function leadingSpaces(line: string): number {
  let count = 0;
  while (count < line.length && line[count] === ' ') count += 1;
  return count;
}

function splitKeyValue(content: string, rawLine: string): { key: string; value: string } {
  const index = content.indexOf(':');
  if (index === -1) {
    throw new Error(`update metadata: expected "key: value", got: ${rawLine}`);
  }
  const key = content.slice(0, index).trim();
  const value = content.slice(index + 1).trim();
  return { key, value };
}

function parseScalar(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function assignFileField(file: RawFileEntry, key: string, value: string): void {
  switch (key) {
    case 'url':
      file.url = parseScalar(value);
      break;
    case 'sha512':
      file.sha512 = parseScalar(value);
      break;
    case 'size':
      file.size = parseScalar(value);
      break;
    case 'blockMapSize':
      // Ignored: not part of UpdateMetadataFile.
      break;
    default:
      // Ignored for forward compatibility.
      break;
  }
}

const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

function validateSha512(value: string, label: string): void {
  if (!SHA512_BASE64.test(value)) {
    throw new Error(`update metadata: ${label} is not a base64-encoded SHA-512 hash: "${value}"`);
  }
}

/**
 * Parse electron-builder's `latest*.yml` updater metadata (see the subset
 * documented above). Throws on anything the installer cannot trust: a
 * missing version, an empty file list, a file missing url/sha512/size, a
 * non-numeric size, or a sha512 that is not a 64-byte base64 hash.
 */
export function parseUpdateMetadata(text: string): UpdateMetadata {
  let version: string | undefined;
  let path: string | undefined;
  let sha512: string | undefined;
  let releaseDate: string | null = null;

  const files: RawFileEntry[] = [];
  let inFiles = false;
  let currentFile: RawFileEntry | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim().length === 0) continue;
    if (rawLine.trim().startsWith('#')) continue;

    const indent = leadingSpaces(rawLine);
    const content = rawLine.slice(indent);

    if (indent === 0) {
      inFiles = false;
      currentFile = null;
      const { key, value } = splitKeyValue(content, rawLine);
      switch (key) {
        case 'version':
          version = parseScalar(value);
          break;
        case 'path':
          path = parseScalar(value);
          break;
        case 'sha512':
          sha512 = parseScalar(value);
          break;
        case 'releaseDate':
          releaseDate = value.length === 0 ? null : parseScalar(value);
          break;
        case 'files':
          if (value.length > 0) {
            throw new Error(`update metadata: "files" must be a list, got an inline value: ${rawLine}`);
          }
          inFiles = true;
          break;
        default:
          // Ignored for forward compatibility.
          break;
      }
      continue;
    }

    if (inFiles && content.startsWith('- ')) {
      currentFile = {};
      files.push(currentFile);
      const rest = content.slice(2);
      if (rest.trim().length > 0) {
        const { key, value } = splitKeyValue(rest, rawLine);
        assignFileField(currentFile, key, value);
      }
      continue;
    }

    if (inFiles && currentFile && indent >= 4) {
      const { key, value } = splitKeyValue(content, rawLine);
      assignFileField(currentFile, key, value);
      continue;
    }

    throw new Error(`update metadata: unexpected line: ${rawLine}`);
  }

  if (!version) {
    throw new Error('update metadata: missing "version"');
  }
  if (files.length === 0) {
    throw new Error('update metadata: "files" must contain at least one entry');
  }

  const parsedFiles: UpdateMetadataFile[] = files.map((file, index) => {
    if (!file.url) {
      throw new Error(`update metadata: files[${index}] is missing "url"`);
    }
    if (!file.sha512) {
      throw new Error(`update metadata: files[${index}] is missing "sha512"`);
    }
    if (file.size === undefined) {
      throw new Error(`update metadata: files[${index}] is missing "size"`);
    }
    if (!/^\d+$/.test(file.size)) {
      throw new Error(`update metadata: files[${index}].size is not numeric: "${file.size}"`);
    }
    validateSha512(file.sha512, `files[${index}].sha512`);
    return { url: file.url, sha512: file.sha512, size: Number(file.size) };
  });

  if (!path) {
    throw new Error('update metadata: missing "path"');
  }
  if (!sha512) {
    throw new Error('update metadata: missing "sha512"');
  }
  validateSha512(sha512, 'sha512');

  return { version, files: parsedFiles, path, sha512, releaseDate };
}
