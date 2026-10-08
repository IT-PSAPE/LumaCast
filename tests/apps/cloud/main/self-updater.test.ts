import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mutable packaged flag read through the electron mock.
const appState = vi.hoisted(() => ({ isPackaged: true }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
  },
}));

type Listener = (...args: any[]) => void;

// Minimal autoUpdater double: an event emitter with the three methods the
// SelfUpdater touches. Hand-rolled so the mock factory needs no imports.
const updater = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>();
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async (): Promise<void> => undefined),
    downloadUpdate: vi.fn(async (): Promise<string> => 'update-file'),
    quitAndInstall: vi.fn((): void => undefined),
    on(event: string, listener: Listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return autoUpdater;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return { autoUpdater, listeners };
});

vi.mock('electron-updater', () => ({ autoUpdater: updater.autoUpdater }));

import { SelfUpdater } from '../../../../apps/cloud/main/self-updater';

beforeEach(() => {
  appState.isPackaged = true;
  updater.listeners.clear();
  updater.autoUpdater.checkForUpdates.mockClear();
  updater.autoUpdater.downloadUpdate.mockClear();
  updater.autoUpdater.quitAndInstall.mockClear();
  updater.autoUpdater.downloadUpdate.mockImplementation(async () => 'update-file');
});

/** Drives a fresh updater to `available` through its own events. */
async function makeAvailable(self: SelfUpdater): Promise<void> {
  await self.check();
  updater.autoUpdater.emit('update-available', { version: '0.2.0' });
  expect(self.state().status).toBe('available');
  expect(self.state().availableVersion).toBe('0.2.0');
}

describe('apps/cloud SelfUpdater install', () => {
  it('downloads an available update, then quits into it once ready', async () => {
    const self = new SelfUpdater();
    await makeAvailable(self);

    updater.autoUpdater.downloadUpdate.mockImplementation(async () => {
      updater.autoUpdater.emit('download-progress', { percent: 50 });
      updater.autoUpdater.emit('update-downloaded', { version: '0.2.0' });
      return 'update-file';
    });

    await self.installAndRestart();

    expect(updater.autoUpdater.downloadUpdate).toHaveBeenCalledOnce();
    expect(updater.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
    expect(self.state().status).toBe('ready');
    expect(self.state().percent).toBe(100);
  });

  it('quits into a ready update without downloading again', async () => {
    const self = new SelfUpdater();
    await makeAvailable(self);
    updater.autoUpdater.emit('update-downloaded', { version: '0.2.0' });
    expect(self.state().status).toBe('ready');

    updater.autoUpdater.downloadUpdate.mockClear();
    updater.autoUpdater.quitAndInstall.mockClear();

    await self.installAndRestart();

    expect(updater.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('surfaces a failed download as error state and does not quit', async () => {
    const self = new SelfUpdater();
    await makeAvailable(self);
    updater.autoUpdater.downloadUpdate.mockRejectedValue(new Error('net down'));

    await expect(self.installAndRestart()).rejects.toThrow('net down');

    expect(updater.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(self.state().status).toBe('error');
    expect(self.state().error).toBe('net down');
  });

  it('refuses to install when no update is pending', async () => {
    const self = new SelfUpdater();

    await expect(self.installAndRestart()).rejects.toThrow(/ready to install/);

    expect(updater.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('joins an in-flight download instead of starting a second one', async () => {
    let resolveDownload!: (value: string) => void;
    updater.autoUpdater.downloadUpdate.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveDownload = (value: string) => {
            updater.autoUpdater.emit('update-downloaded', { version: '0.2.0' });
            resolve(value);
          };
        }),
    );

    const self = new SelfUpdater();
    await makeAvailable(self);

    const first = self.installAndRestart();
    const second = self.installAndRestart();
    resolveDownload('update-file');
    await first;
    await second;

    expect(updater.autoUpdater.downloadUpdate).toHaveBeenCalledOnce();
    expect(updater.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('does nothing when unpackaged', async () => {
    appState.isPackaged = false;
    const self = new SelfUpdater();
    expect(self.state().status).toBe('unavailable');

    await self.installAndRestart();

    expect(updater.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});
