import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function filePathFromFileUrl(src: string): string | null {
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

function decodeCastMediaPath(src: string): string | null {
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

/** Resolve only local persisted media forms at the Electron trust boundary. */
export function resolveLocalMediaSourcePath(src: string): string | null {
  if (!src) return null;
  if (src.startsWith('cast-media://')) return decodeCastMediaPath(src);
  if (src.startsWith('file://')) return filePathFromFileUrl(src);
  if (path.isAbsolute(src)) return src;
  return null;
}
