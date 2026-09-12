import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Sibling copy: `app/main/media-source-path.ts` implements the same
// library-reference additions (the `MEDIA_LIBRARY_*`/`*MediaLibrary*`
// exports and the library branch in `resolveLocalMediaSourcePath`). This
// module runs in an Electron `utilityProcess` and cannot import `app/main`,
// so the two stay hand-synced — if you change one, change the other.

/**
 * Stored form for an app-owned library copy:
 * `cast-media://library/<64 lowercase hex chars>[.<1-12 char lowercase
 * alphanumeric ext>]`. The hex is a SHA-256 of the file's bytes
 * (content-addressed: re-importing the same bytes reuses one copy).
 *
 * The file-name pattern below admits no `/`, `\`, `%`, or `..` — every
 * character it accepts is hex or `[a-z0-9]`, neither of which can spell a
 * separator, an escape, or a traversal segment. That makes escaping the
 * library directory impossible *by pattern*, the same reasoning
 * `MANAGED_MEDIA_ID_PATTERN` in `app/main/media-capability.ts` uses for
 * managed ids: there is no path parsing to fool, because a valid reference
 * never contains a path.
 */
export const MEDIA_LIBRARY_PREFIX = 'library/';

const MEDIA_LIBRARY_FILE_NAME_PATTERN = /^[0-9a-f]{64}(?:\.[a-z0-9]{1,12})?$/;

let mediaLibraryDirectory: string | null = null;

/** Configures the absolute library directory for this process. Pass null to unset (tests). */
export function setMediaLibraryDirectory(directory: string | null): void {
  mediaLibraryDirectory = directory;
}

export function getMediaLibraryDirectory(): string | null {
  return mediaLibraryDirectory;
}

/** The `<hash>[.<ext>]` file name, or null if `src` is not a library reference. */
export function mediaLibraryFileName(src: string): string | null {
  if (!src.startsWith('cast-media://')) return null;
  const rest = src.slice('cast-media://'.length);
  if (!rest.startsWith(MEDIA_LIBRARY_PREFIX)) return null;
  const fileName = rest.slice(MEDIA_LIBRARY_PREFIX.length);
  return MEDIA_LIBRARY_FILE_NAME_PATTERN.test(fileName) ? fileName : null;
}

/** True for a well-formed `cast-media://library/<hash>[.<ext>]` reference. */
export function isMediaLibraryReference(src: string): boolean {
  return mediaLibraryFileName(src) !== null;
}

/** Wraps a validated library file name as a stored source. Throws on a file name that does not match the pattern. */
export function buildMediaLibraryReference(fileName: string): string {
  if (!MEDIA_LIBRARY_FILE_NAME_PATTERN.test(fileName)) {
    throw new Error(`Invalid media library file name: ${fileName}`);
  }
  return `cast-media://${MEDIA_LIBRARY_PREFIX}${fileName}`;
}

export function filePathFromFileUrl(src: string): string | null {
  try {
    return fileURLToPath(new URL(src));
  } catch {
    const rawPath = src.slice('file://'.length);
    if (!rawPath) return null;
    try {
      return decodeURIComponent(rawPath);
    } catch {
      return rawPath;
    }
  }
}

export function decodeCastMediaPath(src: string): string | null {
  const encodedPath = src.slice('cast-media://'.length);
  if (!encodedPath) return null;

  let decodedOnce: string;
  try {
    decodedOnce = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }

  if (!encodedPath.includes('%25')) return decodedOnce;

  try {
    const decodedTwice = decodeURIComponent(decodedOnce);
    if (decodedTwice === decodedOnce) return decodedOnce;
    if (existsSync(decodedOnce)) return decodedOnce;
    if (existsSync(decodedTwice)) return decodedTwice;
    return decodedTwice;
  } catch {
    return decodedOnce;
  }
}

export function resolveLocalMediaSourcePath(src: string): string | null {
  if (!src) return null;
  if (src.startsWith('cast-media://')) {
    const rest = src.slice('cast-media://'.length);
    if (rest.startsWith(MEDIA_LIBRARY_PREFIX)) {
      // Library form is checked before the generic percent-decode below:
      // decoding `library/<hash>` as an encoded path would just yield that
      // same relative string back, which is not what a library reference
      // means. Once we're in the `library/` namespace there is no fallback —
      // a payload that fails the file-name pattern is rejected outright
      // rather than reinterpreted as a legacy encoded path.
      const fileName = mediaLibraryFileName(src);
      if (!fileName) return null;
      const directory = getMediaLibraryDirectory();
      // Never guess a directory: with none configured, the reference is
      // simply unresolvable right now, not invalid.
      return directory ? path.join(directory, fileName) : null;
    }
    return decodeCastMediaPath(src);
  }
  if (src.startsWith('file://')) return filePathFromFileUrl(src);
  if (path.isAbsolute(src)) return src;
  return null;
}

export function toCastMediaSource(src: string): string | null {
  if (!src || src.startsWith('blob:')) return null;
  // A library reference is already the stored form; re-wrapping it as an
  // encoded absolute path would both be wrong (it isn't a filesystem path to
  // the caller) and, once a library directory is configured, would succeed
  // at resolving one and corrupt the stored value.
  if (isMediaLibraryReference(src)) return src;
  const localPath = resolveLocalMediaSourcePath(src);
  if (!localPath) return src;
  return `cast-media://${encodeURIComponent(localPath)}`;
}

export function isBrokenMediaSource(src: string): boolean {
  const localPath = resolveLocalMediaSourcePath(src);
  // Includes the library case: with no library directory configured yet,
  // resolution returns null and this reports "not broken". That is the
  // correct default — an asset we cannot check right now is unverified, not
  // proven missing, and this function must never flag every library asset as
  // broken just because it ran before the directory was wired up (e.g.
  // during startup or in a test that never calls setMediaLibraryDirectory).
  if (!localPath) return false;
  return !existsSync(localPath);
}
