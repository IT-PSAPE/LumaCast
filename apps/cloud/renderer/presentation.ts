// Pure, renderer-side view logic: how a suite app's state, an operation, or
// LumaCloud's own self-update state reads as UI copy. Nothing here touches
// the DOM, the api, or React — screens and components call these to turn
// contract data into labels, and tests exercise them directly.
import { compareVersions, type AppRelease, type AppState, type HostPlatform, type SuiteAppId, type VersionScheme } from '@lumacast/suite';
import type { OperationSnapshot, OperationStatus, SelfUpdateState } from '../shared/desktop-api';

const ACTIVE_OPERATION_STATUSES: ReadonlySet<OperationStatus> = new Set([
  'queued',
  'downloading',
  'verifying',
  'installing',
  'removing',
]);

const OPERATION_STATUS_WORDS: Record<OperationStatus, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  verifying: 'Verifying',
  installing: 'Installing',
  removing: 'Removing',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export type PrimaryActionKind =
  | 'install'
  | 'update'
  | 'open'
  | 'self-check'
  | 'self-install'
  | 'self-restart'
  | 'none';

export interface PrimaryAction {
  label: string;
  action: PrimaryActionKind;
}

/** The status-pill copy for one app's derived state. */
export function statusLabel(state: AppState): string {
  switch (state.status) {
    case 'not-installed':
      return 'Not installed';
    case 'up-to-date':
      return `Installed ${state.installed?.version ?? '—'}`;
    case 'update-available':
      return `Update available ${state.installed?.version ?? '—'} → ${state.latest?.version ?? '—'}`;
    case 'ahead':
      return 'Newer than published';
    case 'unknown':
    default:
      // An installed app whose catalog has nothing yet (LumaCloud before its
      // first release) is still installed; only say "Unknown" when there is
      // no version to show.
      return state.installed ? `Installed ${state.installed.version}` : 'Unknown';
  }
}

/** The newest, still-active (non-terminal) operation queued for `app`, if any. */
export function activeOperationFor(
  app: SuiteAppId,
  operations: readonly OperationSnapshot[],
): OperationSnapshot | undefined {
  return operations.find((operation) => operation.app === app && ACTIVE_OPERATION_STATUSES.has(operation.status));
}

/** Whether an operation can still be cancelled (before bytes start moving, or while they still are). */
export function isCancellable(operation: OperationSnapshot | null | undefined): boolean {
  return operation?.status === 'queued' || operation?.status === 'downloading';
}

/** The inline progress line shown under an operation's bar. */
export function operationStatusLabel(operation: OperationSnapshot): string {
  const word = OPERATION_STATUS_WORDS[operation.status] ?? operation.status;
  if (operation.status !== 'downloading') return word;

  const percent = operation.progress.percent;
  const parts = [percent === null ? word : `${word} ${Math.round(percent)}%`];
  const rate = formatRate(operation.progress.bytesPerSecond);
  if (rate) parts.push(rate);
  return parts.join(' · ');
}

function selfPrimaryAction(selfUpdate: SelfUpdateState | undefined): PrimaryAction {
  switch (selfUpdate?.status) {
    case 'available':
      return { label: 'Install Update', action: 'self-install' };
    case 'ready':
      return { label: 'Restart to Update', action: 'self-restart' };
    case 'checking':
      return { label: 'Checking…', action: 'none' };
    case 'downloading':
      return { label: 'Downloading…', action: 'none' };
    case 'unavailable':
      return { label: 'Unavailable', action: 'none' };
    case 'idle':
    case 'up-to-date':
    case 'error':
    case undefined:
    default:
      return { label: 'Check for Updates', action: 'self-check' };
  }
}

/**
 * The card's primary button for one app: for LumaCloud's own entry this reads
 * `selfUpdate` instead of `state.status` (Cloud manages itself through its
 * updater, never through install/uninstall operations). For every other app,
 * an active operation takes over the button (disabled, operation-labelled)
 * until it finishes.
 */
export function primaryAction(
  state: AppState,
  operations: readonly OperationSnapshot[],
  selfUpdate?: SelfUpdateState,
): PrimaryAction {
  if (state.app === 'cloud') {
    return selfPrimaryAction(selfUpdate);
  }

  const active = activeOperationFor(state.app, operations);
  if (active) {
    return { label: operationStatusLabel(active), action: 'none' };
  }

  switch (state.status) {
    case 'not-installed':
      // Nothing published yet (Flux before its first per-app release): the
      // catalog has no artifact to install, so the button is inert.
      return state.latest
        ? { label: 'Install', action: 'install' }
        : { label: 'Not available', action: 'none' };
    case 'update-available':
      return { label: 'Update', action: 'update' };
    case 'up-to-date':
    case 'ahead':
    case 'unknown':
    default:
      return { label: 'Open', action: 'open' };
  }
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** `1536 -> "1.5 KB"`; whole bytes stay unitless-precise (`"512 B"`). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const precision = exponent === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${BYTE_UNITS[exponent]}`;
}

/** `"12.3 MB/s"`, or `""` for an unknown/zero rate (callers omit the segment). */
export function formatRate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '';
  return `${formatBytes(bytesPerSecond)}/s`;
}

const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const MONTH = DAY * 30;
const YEAR = DAY * 365;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** `null -> "Never"`; otherwise the coarsest unit that reads naturally. */
export function formatRelativeTime(iso: string | null, now: Date | number = Date.now()): string {
  if (!iso) return 'Never';

  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'Never';

  const nowMs = now instanceof Date ? now.getTime() : now;
  const diffSeconds = Math.floor((nowMs - then) / 1000);
  if (diffSeconds < 45) return 'just now';
  if (diffSeconds < HOUR) return plural(Math.round(diffSeconds / MINUTE), 'minute');
  if (diffSeconds < DAY) return plural(Math.round(diffSeconds / HOUR), 'hour');
  if (diffSeconds < MONTH) return plural(Math.round(diffSeconds / DAY), 'day');
  if (diffSeconds < YEAR) return plural(Math.round(diffSeconds / MONTH), 'month');
  return plural(Math.round(diffSeconds / YEAR), 'year');
}

/** The row action in the "other versions" sheet, derived from version order alone. */
export function versionActionLabel(
  release: AppRelease,
  installedVersion: string | null,
  scheme: VersionScheme = 'semver',
): 'Install' | 'Update' | 'Downgrade' | 'Reinstall' {
  if (!installedVersion) return 'Install';

  const comparison = compareVersions(release.version, installedVersion, scheme);
  if (comparison === 0) return 'Reinstall';
  return comparison > 0 ? 'Update' : 'Downgrade';
}

/** The platform-appropriate wording for revealing an installed app's location. */
export function revealLabel(platform: HostPlatform): string {
  switch (platform) {
    case 'darwin':
      return 'Show in Finder';
    case 'win32':
      return 'Show in Explorer';
    case 'linux':
      return 'Show in Files';
    default:
      return 'Show in Files';
  }
}
