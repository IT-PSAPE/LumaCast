// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const { construct, window } = vi.hoisted(() => ({
  construct: vi.fn(),
  window: {
    once: vi.fn(), show: vi.fn(), isDestroyed: () => false,
    loadFile: vi.fn(), loadURL: vi.fn(), setTitleBarOverlay: vi.fn(),
    webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() },
  },
}));
vi.mock('electron', () => ({
  BrowserWindow: class { constructor(options: unknown) { construct(options); return window; } },
  nativeTheme: { shouldUseDarkColors: true, on: vi.fn(), off: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

import { createAppWindow, type AppWindowOptions } from '../../../../packages/desktop/src/app-window';

const options: AppWindowOptions = {
  title: 'Test', width: 1000, height: 800, minWidth: 400, minHeight: 300,
  backgroundColor: '#000000', webPreferences: {},
  rendererIndexPath: '/app/out/renderer/index.html', devServerUrl: undefined,
  isTrustedUrl: () => true, describeUrlScheme: () => 'file:',
};

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('application window icon', () => {
  it('passes the app-owned icon to Electron when creating the window', () => {
    vi.useFakeTimers();
    createAppWindow({ ...options, icon: '/app/resources/icon.ico' });
    expect(construct).toHaveBeenCalledWith(expect.objectContaining({ icon: '/app/resources/icon.ico' }));
  });

  it('preserves the default icon for callers without their own artwork', () => {
    vi.useFakeTimers();
    createAppWindow(options);
    expect(construct.mock.calls[0][0]).not.toHaveProperty('icon');
  });
});
