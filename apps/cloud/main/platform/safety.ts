// Two guards every platform adapter must apply before a destructive
// operation. Kept together, and kept tiny, because both exist for the same
// reason: a derived path or a wrong app id must never turn install/uninstall
// into "delete something unrelated" or "delete LumaCloud itself".
import path from 'node:path';
import type { SuiteAppDescriptor } from '@lumacast/suite';

export type PathStyle = 'posix' | 'win32';

/**
 * Throws unless `target`, once normalized, is `base` itself or strictly
 * nested inside it. Every remove/trash/rename destination and every
 * elevated-shell path an adapter builds must pass through here first — the
 * one gate that keeps a bad artifact name or a mis-derived directory from
 * reaching outside an install location, a Cloud-owned staging dir, or a
 * managed app's own user-data/updater-cache dir.
 */
export function assertInside(base: string, target: string, style: PathStyle = 'posix'): void {
  const p = style === 'win32' ? path.win32 : path.posix;
  const normalizedBase = p.normalize(base);
  const normalizedTarget = p.normalize(target);
  const baseWithSep = normalizedBase.endsWith(p.sep) ? normalizedBase : normalizedBase + p.sep;
  if (normalizedTarget !== normalizedBase && !normalizedTarget.startsWith(baseWithSep)) {
    throw new Error(`Refusing to touch a path outside ${normalizedBase}: ${normalizedTarget}`);
  }
}

/**
 * LumaCloud manages the other suite apps, never itself: installing over
 * itself would overwrite the running app's own files mid-install, and
 * uninstalling itself would delete a running app. Every adapter's install
 * and uninstall calls this first.
 */
export function assertNotSelf(app: SuiteAppDescriptor): void {
  if (app.id === 'cloud') {
    throw new Error('LumaCloud cannot install or remove itself');
  }
}
