import { describe, expect, it, vi } from 'vitest';

// ipc.ts imports `ipcMain`/`shell` from 'electron' at module scope for
// `registerIpc` (not exercised here); `createIpcHandlers` never calls them,
// but the import still has to resolve to *something* under plain Node/vitest.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { showItemInFolder: vi.fn(), openExternal: vi.fn(async () => {}) },
}));

import { createIpcHandlers, type IpcEffects, type IpcSelfUpdater, type IpcSuiteManager } from '../../../../apps/cloud/main/ipc';
import { IPC_CHANNELS } from '../../../../apps/cloud/main/ipc-channels';
import type { CloudSettings, OperationSnapshot, SelfUpdateState, SuiteOverview } from '../../../../apps/cloud/shared/desktop-api';

function fakeOverview(): SuiteOverview {
  return {
    host: {
      platform: 'darwin',
      arch: 'arm64',
      cloudVersion: '0.5.0',
      packaged: true,
      installLocations: { user: '/u', system: '/s' },
      systemScopeWritable: true,
    },
    settings: { installScope: 'user', checkOnLaunch: true, grants: [] },
    catalog: { status: 'ready', fetchedAt: null, error: null },
    apps: [],
    selfUpdate: { status: 'idle', availableVersion: null, percent: null, error: null, checkedAt: null },
  };
}

function fakeOperation(): OperationSnapshot {
  return {
    id: 'op-1',
    app: 'cast',
    kind: 'install',
    version: '1.0.0',
    status: 'queued',
    progress: { transferred: 0, total: null, percent: null, bytesPerSecond: null },
    error: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
  };
}

function fakeSettings(): CloudSettings {
  return { installScope: 'user', checkOnLaunch: true, grants: [] };
}

function makeManager(overrides: Partial<IpcSuiteManager> = {}): IpcSuiteManager {
  return {
    overview: vi.fn(() => fakeOverview()),
    refresh: vi.fn(async () => fakeOverview()),
    releases: vi.fn(() => []),
    grant: vi.fn(async () => fakeSettings()),
    revoke: vi.fn(async () => fakeSettings()),
    updateSettings: vi.fn(async () => fakeSettings()),
    install: vi.fn(async () => fakeOperation()),
    uninstall: vi.fn(async () => fakeOperation()),
    cancel: vi.fn(async () => {}),
    operations: vi.fn(() => []),
    open: vi.fn(async () => {}),
    reveal: vi.fn(() => '/Applications/LumaCast.app'),
    releaseNotesUrl: vi.fn(() => 'https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v1.0.0'),
    on: vi.fn(),
    ...overrides,
  };
}

function makeSelfUpdater(overrides: Partial<IpcSelfUpdater> = {}): IpcSelfUpdater {
  const state = (): SelfUpdateState => ({ status: 'idle', availableVersion: null, percent: null, error: null, checkedAt: null });
  return {
    state: vi.fn(state),
    check: vi.fn(async () => state()),
    installAndRestart: vi.fn(),
    on: vi.fn(),
    ...overrides,
  };
}

function makeEffects(overrides: Partial<IpcEffects> = {}): IpcEffects {
  return {
    showItemInFolder: vi.fn(),
    openExternal: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('apps/cloud createIpcHandlers argument validation', () => {
  it('rejects a bad app id on every channel that takes one', async () => {
    const manager = makeManager();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), makeEffects());

    await expect(handlers[IPC_CHANNELS.releases]('not-a-real-app')).rejects.toThrow();
    await expect(handlers[IPC_CHANNELS.grant]('not-a-real-app')).rejects.toThrow();
    await expect(handlers[IPC_CHANNELS.revoke]('not-a-real-app')).rejects.toThrow();
    await expect(handlers[IPC_CHANNELS.install]('not-a-real-app')).rejects.toThrow();
    await expect(handlers[IPC_CHANNELS.uninstall]('not-a-real-app')).rejects.toThrow();
    await expect(handlers[IPC_CHANNELS.open]('not-a-real-app')).rejects.toThrow();
    await expect(handlers[IPC_CHANNELS.reveal]('not-a-real-app')).rejects.toThrow();
    await expect(handlers[IPC_CHANNELS.openReleaseNotes]('not-a-real-app', '1.0.0')).rejects.toThrow();

    expect(manager.releases).not.toHaveBeenCalled();
    expect(manager.grant).not.toHaveBeenCalled();
    expect(manager.install).not.toHaveBeenCalled();
  });

  it('rejects a non-string app id (object, number)', async () => {
    const manager = makeManager();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), makeEffects());

    await expect(handlers[IPC_CHANNELS.releases]({ malicious: true })).rejects.toThrow();
    await expect(handlers[IPC_CHANNELS.releases](42)).rejects.toThrow();
  });

  it('rejects an over-long version string', async () => {
    const manager = makeManager();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), makeEffects());
    await expect(handlers[IPC_CHANNELS.install]('cast', 'v'.repeat(65))).rejects.toThrow();
    expect(manager.install).not.toHaveBeenCalled();
  });

  it('rejects an operation id that is not a string', async () => {
    const manager = makeManager();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), makeEffects());
    await expect(handlers[IPC_CHANNELS.cancel](123)).rejects.toThrow();
  });

  it('rejects a malformed settings patch', async () => {
    const manager = makeManager();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), makeEffects());
    await expect(handlers[IPC_CHANNELS.updateSettings]({ installScope: 'not-a-scope' })).rejects.toThrow();
    expect(manager.updateSettings).not.toHaveBeenCalled();
  });

  it('rejects a malformed uninstall options object', async () => {
    const manager = makeManager();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), makeEffects());
    await expect(handlers[IPC_CHANNELS.uninstall]('cast', { removeUserData: 'yes' })).rejects.toThrow();
  });
});

describe('apps/cloud createIpcHandlers delegation', () => {
  it('delegates simple reads/writes straight to the manager', async () => {
    const manager = makeManager();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), makeEffects());

    await handlers[IPC_CHANNELS.overview]();
    await handlers[IPC_CHANNELS.refresh]();
    await handlers[IPC_CHANNELS.releases]('cast');
    await handlers[IPC_CHANNELS.grant]('cast');
    await handlers[IPC_CHANNELS.revoke]('cast');
    await handlers[IPC_CHANNELS.updateSettings]({ checkOnLaunch: false });
    await handlers[IPC_CHANNELS.install]('cast', '1.0.0');
    await handlers[IPC_CHANNELS.uninstall]('cast', { removeUserData: true });
    await handlers[IPC_CHANNELS.cancel]('op-1');
    await handlers[IPC_CHANNELS.operations]();
    await handlers[IPC_CHANNELS.open]('cast');

    expect(manager.overview).toHaveBeenCalledOnce();
    expect(manager.refresh).toHaveBeenCalledOnce();
    expect(manager.releases).toHaveBeenCalledWith('cast');
    expect(manager.grant).toHaveBeenCalledWith('cast');
    expect(manager.revoke).toHaveBeenCalledWith('cast');
    expect(manager.updateSettings).toHaveBeenCalledWith({ checkOnLaunch: false });
    expect(manager.install).toHaveBeenCalledWith('cast', '1.0.0');
    expect(manager.uninstall).toHaveBeenCalledWith('cast', { removeUserData: true });
    expect(manager.cancel).toHaveBeenCalledWith('op-1');
    expect(manager.operations).toHaveBeenCalledOnce();
    expect(manager.open).toHaveBeenCalledWith('cast');
  });

  it('install() without a version delegates with version undefined', async () => {
    const manager = makeManager();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), makeEffects());
    await handlers[IPC_CHANNELS.install]('cast');
    expect(manager.install).toHaveBeenCalledWith('cast', undefined);
  });

  it('reveal() hands the manager\'s path to shell.showItemInFolder', async () => {
    const manager = makeManager({ reveal: vi.fn(() => '/Applications/LumaCast.app') });
    const effects = makeEffects();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), effects);

    await handlers[IPC_CHANNELS.reveal]('cast');

    expect(manager.reveal).toHaveBeenCalledWith('cast');
    expect(effects.showItemInFolder).toHaveBeenCalledWith('/Applications/LumaCast.app');
  });

  it('openReleaseNotes() opens an approved github.com URL', async () => {
    const manager = makeManager({
      releaseNotesUrl: vi.fn(() => 'https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v1.0.0'),
    });
    const effects = makeEffects();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), effects);

    await handlers[IPC_CHANNELS.openReleaseNotes]('cast', '1.0.0');

    expect(manager.releaseNotesUrl).toHaveBeenCalledWith('cast', '1.0.0');
    expect(effects.openExternal).toHaveBeenCalledWith('https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v1.0.0');
  });

  it('openReleaseNotes() refuses a URL the manager returned outside the approved allow-list', async () => {
    const manager = makeManager({ releaseNotesUrl: vi.fn(() => 'https://evil.example.com/not-github') });
    const effects = makeEffects();
    const handlers = createIpcHandlers(manager, makeSelfUpdater(), effects);

    await expect(handlers[IPC_CHANNELS.openReleaseNotes]('cast', '1.0.0')).rejects.toThrow(/unapproved/);
    expect(effects.openExternal).not.toHaveBeenCalled();
  });

  it('delegates self-update channels to the self-updater', async () => {
    const selfUpdater = makeSelfUpdater();
    const handlers = createIpcHandlers(makeManager(), selfUpdater, makeEffects());

    await handlers[IPC_CHANNELS.checkForSelfUpdate]();
    await handlers[IPC_CHANNELS.installSelfUpdate]();

    expect(selfUpdater.check).toHaveBeenCalledOnce();
    expect(selfUpdater.installAndRestart).toHaveBeenCalledOnce();
  });
});
