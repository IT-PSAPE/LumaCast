// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

const electron = vi.hoisted(() => ({
  app: { quit: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  clipboard: {}, BrowserWindow: {}, dialog: {}, shell: {}, Menu: {}, webContents: {},
}));
vi.mock('electron', () => electron);
vi.mock('../../../../apps/stream/node_modules/electron/index.js', () => electron);
import { registerStreamIpc } from '../../../../apps/stream/main/ipc';
import { IPC_CHANNELS } from '../../../../apps/stream/main/ipc-channels';

afterEach(() => vi.clearAllMocks());

describe('Stream product quit bridge', () => {
  it('routes only the trusted current main frame into graceful app quit', () => {
    const frame = { url: 'app://trusted' };
    const contents = { mainFrame: frame };
    const dependencies = Array.from({ length: 17 }, () => ({}));
    const register = registerStreamIpc as unknown as (...args: unknown[]) => () => void;
    const unregister = register(...dependencies, () => contents, (url: string) => url === 'app://trusted');
    const handler = electron.ipcMain.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.quit)?.[1];
    expect(handler).toBeTypeOf('function');
    handler!({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent);
    expect(electron.app.quit).toHaveBeenCalledTimes(1);
    for (const event of [
      { sender: {}, senderFrame: frame },
      { sender: contents, senderFrame: { url: 'app://trusted' } },
      { sender: contents, senderFrame: null },
    ]) expect(() => handler!(event as unknown as IpcMainInvokeEvent)).toThrow('Untrusted renderer invocation.');
    frame.url = 'app://untrusted';
    expect(() => handler!({ sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent)).toThrow('Untrusted renderer invocation.');
    expect(electron.app.quit).toHaveBeenCalledTimes(1);
    unregister();
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.quit);
  });
});
