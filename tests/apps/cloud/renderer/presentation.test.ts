import { describe, expect, it } from 'vitest';
import type { AppRelease, AppState } from '@lumacast/suite';
import type { OperationSnapshot, SelfUpdateState } from '../../../../apps/cloud/shared/desktop-api';
import {
  activeOperationFor,
  formatBytes,
  formatRate,
  formatRelativeTime,
  isCancellable,
  operationStatusLabel,
  primaryAction,
  revealLabel,
  statusLabel,
  versionActionLabel,
} from '../../../../apps/cloud/renderer/presentation';

function makeRelease(overrides: Partial<AppRelease> = {}): AppRelease {
  return {
    app: 'cast',
    version: '0.1.27',
    tag: 'cast-v0.1.27',
    legacy: false,
    publishedAt: '2026-09-01T00:00:00.000Z',
    notesUrl: 'https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v0.1.27',
    assets: [],
    ...overrides,
  };
}

function makeAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    app: 'cast',
    status: 'not-installed',
    installed: null,
    latest: makeRelease(),
    releases: [makeRelease()],
    ...overrides,
  };
}

function makeOperation(overrides: Partial<OperationSnapshot> = {}): OperationSnapshot {
  return {
    id: 'op-1',
    app: 'cast',
    kind: 'install',
    version: '0.1.27',
    status: 'queued',
    progress: { transferred: 0, total: 1000, percent: 0, bytesPerSecond: null },
    error: null,
    startedAt: '2026-09-26T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

function makeSelfUpdate(overrides: Partial<SelfUpdateState> = {}): SelfUpdateState {
  return {
    status: 'idle',
    availableVersion: null,
    percent: null,
    error: null,
    checkedAt: null,
    ...overrides,
  };
}

describe('statusLabel', () => {
  it('labels a not-installed app', () => {
    expect(statusLabel(makeAppState({ status: 'not-installed', installed: null }))).toBe('Not installed');
  });

  it('labels an up-to-date app with its installed version', () => {
    const state = makeAppState({
      status: 'up-to-date',
      installed: { app: 'cast', version: '0.1.27', location: '/Applications/LumaCast.app', scope: 'user' },
    });
    expect(statusLabel(state)).toBe('Installed 0.1.27');
  });

  it('labels an app with an available update, from -> to', () => {
    const state = makeAppState({
      status: 'update-available',
      installed: { app: 'cast', version: '0.1.26', location: '/Applications/LumaCast.app', scope: 'user' },
      latest: makeRelease({ version: '0.1.27' }),
    });
    expect(statusLabel(state)).toBe('Update available 0.1.26 → 0.1.27');
  });

  it('labels an app ahead of the catalog', () => {
    expect(statusLabel(makeAppState({ status: 'ahead' }))).toBe('Newer than published');
  });

  it('labels an unknown status', () => {
    expect(statusLabel(makeAppState({ status: 'unknown', installed: null }))).toBe('Unknown');
  });

  it('shows the installed version when the status is unknown but a copy is on disk', () => {
    const state = makeAppState({ status: 'unknown' });
    expect(statusLabel(state)).toBe(`Installed ${state.installed?.version}`);
  });
});

describe('activeOperationFor / isCancellable', () => {
  it('finds the newest non-terminal operation for an app', () => {
    const ops = [
      makeOperation({ id: 'op-done', app: 'cast', status: 'done' }),
      makeOperation({ id: 'op-active', app: 'cast', status: 'downloading' }),
      makeOperation({ id: 'op-other-app', app: 'flux', status: 'downloading' }),
    ];
    expect(activeOperationFor('cast', ops)?.id).toBe('op-active');
  });

  it('returns undefined when every operation for the app is terminal', () => {
    const ops = [makeOperation({ status: 'done' }), makeOperation({ status: 'cancelled' })];
    expect(activeOperationFor('cast', ops)).toBeUndefined();
  });

  it('treats queued and downloading as cancellable, and nothing else', () => {
    expect(isCancellable(makeOperation({ status: 'queued' }))).toBe(true);
    expect(isCancellable(makeOperation({ status: 'downloading' }))).toBe(true);
    expect(isCancellable(makeOperation({ status: 'verifying' }))).toBe(false);
    expect(isCancellable(makeOperation({ status: 'installing' }))).toBe(false);
    expect(isCancellable(makeOperation({ status: 'removing' }))).toBe(false);
    expect(isCancellable(undefined)).toBe(false);
    expect(isCancellable(null)).toBe(false);
  });
});

describe('operationStatusLabel', () => {
  it('shows percent and rate while downloading', () => {
    const op = makeOperation({
      status: 'downloading',
      progress: { transferred: 500, total: 1000, percent: 50, bytesPerSecond: 2 * 1024 * 1024 },
    });
    expect(operationStatusLabel(op)).toBe('Downloading 50% · 2.0 MB/s');
  });

  it('omits the rate segment when the rate is unknown', () => {
    const op = makeOperation({
      status: 'downloading',
      progress: { transferred: 500, total: 1000, percent: 50, bytesPerSecond: null },
    });
    expect(operationStatusLabel(op)).toBe('Downloading 50%');
  });

  it('shows the plain word for non-downloading statuses', () => {
    expect(operationStatusLabel(makeOperation({ status: 'queued' }))).toBe('Queued');
    expect(operationStatusLabel(makeOperation({ status: 'verifying' }))).toBe('Verifying');
    expect(operationStatusLabel(makeOperation({ status: 'installing' }))).toBe('Installing');
    expect(operationStatusLabel(makeOperation({ status: 'removing' }))).toBe('Removing');
    expect(operationStatusLabel(makeOperation({ status: 'failed' }))).toBe('Failed');
    expect(operationStatusLabel(makeOperation({ status: 'cancelled' }))).toBe('Cancelled');
  });
});

describe('primaryAction', () => {
  it('offers Install for a not-installed app', () => {
    const state = makeAppState({ status: 'not-installed' });
    expect(primaryAction(state, [])).toEqual({ label: 'Install', action: 'install' });
  });

  it('is inert for a not-installed app with nothing published', () => {
    const state = makeAppState({ status: 'not-installed', installed: null, latest: null, releases: [] });
    expect(primaryAction(state, [])).toEqual({ label: 'Not available', action: 'none' });
  });

  it('offers Update when a newer release exists', () => {
    const state = makeAppState({ status: 'update-available' });
    expect(primaryAction(state, [])).toEqual({ label: 'Update', action: 'update' });
  });

  it('offers Open when up to date, ahead, or unknown', () => {
    expect(primaryAction(makeAppState({ status: 'up-to-date' }), [])).toEqual({ label: 'Open', action: 'open' });
    expect(primaryAction(makeAppState({ status: 'ahead' }), [])).toEqual({ label: 'Open', action: 'open' });
    expect(primaryAction(makeAppState({ status: 'unknown' }), [])).toEqual({ label: 'Open', action: 'open' });
  });

  it('defers to the active operation over the status-derived action', () => {
    const state = makeAppState({ status: 'not-installed' });
    const op = makeOperation({ app: 'cast', status: 'verifying' });
    expect(primaryAction(state, [op])).toEqual({ label: 'Verifying', action: 'none' });
  });

  it('ignores an active operation belonging to a different app', () => {
    const state = makeAppState({ app: 'cast', status: 'not-installed' });
    const op = makeOperation({ app: 'flux', status: 'downloading' });
    expect(primaryAction(state, [op])).toEqual({ label: 'Install', action: 'install' });
  });

  it("reads LumaCloud's own card from selfUpdate, never from its AppState status", () => {
    const cloudState = makeAppState({ app: 'cloud', status: 'up-to-date' });

    expect(primaryAction(cloudState, [], makeSelfUpdate({ status: 'idle' }))).toEqual({
      label: 'Check for Updates',
      action: 'self-check',
    });
    expect(primaryAction(cloudState, [], makeSelfUpdate({ status: 'up-to-date' }))).toEqual({
      label: 'Check for Updates',
      action: 'self-check',
    });
    expect(primaryAction(cloudState, [], makeSelfUpdate({ status: 'checking' }))).toEqual({
      label: 'Checking…',
      action: 'none',
    });
    expect(primaryAction(cloudState, [], makeSelfUpdate({ status: 'available' }))).toEqual({
      label: 'Install Update',
      action: 'self-install',
    });
    expect(primaryAction(cloudState, [], makeSelfUpdate({ status: 'downloading' }))).toEqual({
      label: 'Downloading…',
      action: 'none',
    });
    expect(primaryAction(cloudState, [], makeSelfUpdate({ status: 'ready' }))).toEqual({
      label: 'Restart to Update',
      action: 'self-restart',
    });
    expect(primaryAction(cloudState, [], makeSelfUpdate({ status: 'error' }))).toEqual({
      label: 'Check for Updates',
      action: 'self-check',
    });
    expect(primaryAction(cloudState, [], makeSelfUpdate({ status: 'unavailable' }))).toEqual({
      label: 'Unavailable',
      action: 'none',
    });
  });

  it('falls back to "Check for Updates" for the cloud card with no selfUpdate given', () => {
    const cloudState = makeAppState({ app: 'cloud', status: 'up-to-date' });
    expect(primaryAction(cloudState, [])).toEqual({ label: 'Check for Updates', action: 'self-check' });
  });
});

describe('versionActionLabel', () => {
  it('reads Install when nothing is installed', () => {
    expect(versionActionLabel(makeRelease({ version: '0.1.27' }), null)).toBe('Install');
  });

  it('reads Update for a newer release, Downgrade for an older one, Reinstall for the same one', () => {
    expect(versionActionLabel(makeRelease({ version: '0.1.27' }), '0.1.26')).toBe('Update');
    expect(versionActionLabel(makeRelease({ version: '0.1.20' }), '0.1.26')).toBe('Downgrade');
    expect(versionActionLabel(makeRelease({ version: '0.1.26' }), '0.1.26')).toBe('Reinstall');
  });

  it('compares the semver-revision scheme by its build revision', () => {
    const scheme = 'semver-revision' as const;
    expect(versionActionLabel(makeRelease({ version: '0.11.0+1' }), '0.11.0', scheme)).toBe('Update');
    expect(versionActionLabel(makeRelease({ version: '0.11.0' }), '0.11.0+1', scheme)).toBe('Downgrade');
    expect(versionActionLabel(makeRelease({ version: '0.11.0+1' }), '0.11.0+1', scheme)).toBe('Reinstall');
  });
});

describe('formatBytes', () => {
  it('handles zero and negative input', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });

  it('keeps whole bytes unitless-precise', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('scales up through KB/MB/GB with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });
});

describe('formatRate', () => {
  it('renders a positive rate as bytes/s', () => {
    expect(formatRate(2 * 1024 * 1024)).toBe('2.0 MB/s');
  });

  it('renders nothing for null, zero, or negative rates', () => {
    expect(formatRate(null)).toBe('');
    expect(formatRate(0)).toBe('');
    expect(formatRate(-100)).toBe('');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-09-26T12:00:00.000Z');

  it('reads "Never" for a null timestamp', () => {
    expect(formatRelativeTime(null, now)).toBe('Never');
  });

  it('reads "Never" for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('Never');
  });

  it('reads "just now" for anything under 45 seconds old', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 10_000).toISOString(), now)).toBe('just now');
  });

  it('pluralizes minutes, hours, and days correctly', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 60_000).toISOString(), now)).toBe('1 minute ago');
    expect(formatRelativeTime(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe('5 minutes ago');
    expect(formatRelativeTime(new Date(now.getTime() - 60 * 60_000).toISOString(), now)).toBe('1 hour ago');
    expect(formatRelativeTime(new Date(now.getTime() - 3 * 60 * 60_000).toISOString(), now)).toBe('3 hours ago');
    expect(formatRelativeTime(new Date(now.getTime() - 24 * 60 * 60_000).toISOString(), now)).toBe('1 day ago');
  });

  it('reads months and years for older timestamps', () => {
    expect(formatRelativeTime(new Date(now.getTime() - 40 * 24 * 60 * 60_000).toISOString(), now)).toBe('1 month ago');
    expect(formatRelativeTime(new Date(now.getTime() - 400 * 24 * 60 * 60_000).toISOString(), now)).toBe('1 year ago');
  });
});

describe('revealLabel', () => {
  it('reads per platform', () => {
    expect(revealLabel('darwin')).toBe('Show in Finder');
    expect(revealLabel('win32')).toBe('Show in Explorer');
    expect(revealLabel('linux')).toBe('Show in Files');
  });
});
