import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  autoUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
  },
  showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false })),
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: vi.fn(() => '0.0') },
  dialog: { showMessageBox: mocks.showMessageBox },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: mocks.autoUpdater,
}));

import { app } from 'electron';
import { AppUpdater } from '../../../app/main/app-updater';

beforeEach(() => {
  (app as unknown as { isPackaged: boolean }).isPackaged = false;
  mocks.autoUpdater.autoDownload = true;
  mocks.autoUpdater.autoInstallOnAppQuit = false;
  mocks.autoUpdater.on.mockClear();
  mocks.autoUpdater.checkForUpdates.mockClear();
  mocks.showMessageBox.mockClear();
});

describe('AppUpdater initialization', () => {
  it('does not initialize electron-updater in an unpackaged app', () => {
    const updater = new AppUpdater({ getMainWindow: () => null });

    updater.initialize();

    expect(mocks.autoUpdater.on).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.autoDownload).toBe(true);
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it('still explains manual update checks without initializing electron-updater', async () => {
    const updater = new AppUpdater({ getMainWindow: () => null });

    await updater.checkForUpdates(true);

    expect(mocks.autoUpdater.on).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(mocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Update checks are only available in installed builds.',
    }));
  });
});
