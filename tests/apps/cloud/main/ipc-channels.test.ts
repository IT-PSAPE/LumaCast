import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  IPC_CHANNELS,
  INVOKED_CHANNELS,
  OPERATION_CHANGE_CHANNEL,
  OVERVIEW_CHANGE_CHANNEL,
} from '../../../../apps/cloud/main/ipc-channels';

// createIpcHandlers's module imports `ipcMain`/`shell` from 'electron' at
// module scope (for `registerIpc`, not exercised by this file).
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { showItemInFolder: vi.fn(), openExternal: vi.fn(async () => {}) },
}));

import { createIpcHandlers, type IpcEffects, type IpcSelfUpdater, type IpcSuiteManager } from '../../../../apps/cloud/main/ipc';

const APP_DIR = path.resolve(__dirname, '../../../../apps/cloud');

function fakeManager(): IpcSuiteManager {
  return {
    overview: () => { throw new Error('not implemented'); },
    refresh: async () => { throw new Error('not implemented'); },
    releases: () => [],
    grant: async () => { throw new Error('not implemented'); },
    revoke: async () => { throw new Error('not implemented'); },
    updateSettings: async () => { throw new Error('not implemented'); },
    install: async () => { throw new Error('not implemented'); },
    uninstall: async () => { throw new Error('not implemented'); },
    cancel: async () => {},
    operations: () => [],
    open: async () => {},
    reveal: () => '/tmp',
    releaseNotesUrl: () => 'https://github.com/IT-PSAPE/LumaCast/releases',
    on: () => undefined,
  };
}

function fakeSelfUpdater(): IpcSelfUpdater {
  return {
    state: () => ({ status: 'unavailable', availableVersion: null, percent: null, error: null, checkedAt: null }),
    check: async () => ({ status: 'unavailable', availableVersion: null, percent: null, error: null, checkedAt: null }),
    installAndRestart: () => undefined,
    on: () => undefined,
  };
}

function fakeEffects(): IpcEffects {
  return {
    showItemInFolder: () => undefined,
    openExternal: async () => undefined,
  };
}

describe('apps/cloud IPC channel identity', () => {
  it('names every privileged channel once, with no duplicates', () => {
    expect(new Set(INVOKED_CHANNELS).size).toBe(INVOKED_CHANNELS.length);
  });

  it('uses the exact channel names main and preload have always used', () => {
    expect(INVOKED_CHANNELS).toEqual([
      'suite-overview',
      'suite-refresh',
      'suite-releases',
      'suite-grant',
      'suite-revoke',
      'suite-update-settings',
      'suite-install',
      'suite-uninstall',
      'suite-cancel',
      'suite-operations',
      'suite-open',
      'suite-reveal',
      'suite-open-release-notes',
      'cloud-check-for-update',
      'cloud-install-update',
    ]);
  });

  it('keeps the two push channels out of the invoked set', () => {
    // Both are main-to-renderer only; if the renderer could invoke them, a
    // compromised renderer could forge an overview or an operation update.
    expect(OVERVIEW_CHANGE_CHANNEL).toBe('suite-overview-change');
    expect(OPERATION_CHANGE_CHANNEL).toBe('suite-operation-change');
    expect(INVOKED_CHANNELS).not.toContain(OVERVIEW_CHANGE_CHANNEL);
    expect(INVOKED_CHANNELS).not.toContain(OPERATION_CHANGE_CHANNEL);
  });

  it('keeps one channel per DesktopAPI method that needs main', () => {
    // onOverview/onOperation subscribe to the push channels directly in the
    // preload and so have no invoked channel; every other CloudDesktopAPI
    // method does.
    const expected: Record<string, string> = {
      overview: IPC_CHANNELS.overview,
      refresh: IPC_CHANNELS.refresh,
      releases: IPC_CHANNELS.releases,
      grant: IPC_CHANNELS.grant,
      revoke: IPC_CHANNELS.revoke,
      updateSettings: IPC_CHANNELS.updateSettings,
      install: IPC_CHANNELS.install,
      uninstall: IPC_CHANNELS.uninstall,
      cancel: IPC_CHANNELS.cancel,
      operations: IPC_CHANNELS.operations,
      open: IPC_CHANNELS.open,
      reveal: IPC_CHANNELS.reveal,
      openReleaseNotes: IPC_CHANNELS.openReleaseNotes,
      checkForSelfUpdate: IPC_CHANNELS.checkForSelfUpdate,
      installSelfUpdate: IPC_CHANNELS.installSelfUpdate,
    };

    for (const channel of Object.values(expected)) {
      expect(INVOKED_CHANNELS).toContain(channel);
    }
    expect(Object.keys(expected)).toHaveLength(INVOKED_CHANNELS.length);
  });

  it('exposes exactly one global, under the name the Cloud renderer reads', () => {
    const preload = readFileSync(path.join(APP_DIR, 'main/preload.ts'), 'utf8');
    const exposed = [...preload.matchAll(/exposeInMainWorld\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(exposed).toEqual(['lumacloud']);
  });

  it('registers a handler for every invocable channel, and no others', () => {
    const handlers = createIpcHandlers(fakeManager(), fakeSelfUpdater(), fakeEffects());
    expect(Object.keys(handlers).sort()).toEqual([...INVOKED_CHANNELS].sort());
  });
});
