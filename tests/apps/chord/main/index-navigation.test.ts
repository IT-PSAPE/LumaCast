import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, MENU_COMMAND_CHANNEL, OPEN_PROJECT_REQUEST_CHANNEL } from '../../../../apps/chord/main/ipc-channels';

const mocks = vi.hoisted(() => ({ app: null as any, windows: [] as any[], createWindow: null as any,
  handlers: new Map<string, (...args: any[]) => any>(), menu: null as any, registries: [] as any[] }));
vi.mock('electron', () => ({
  get app() { return mocks.app; },
  BrowserWindow: { getAllWindows: () => mocks.windows.filter((window) => !window.destroyed) },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  dialog: {}, Menu: { getApplicationMenu: () => null }, shell: { showItemInFolder: vi.fn() },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) },
}));
vi.mock('node:fs/promises', async (importOriginal) => { const original = await importOriginal<typeof import('node:fs/promises')>(); const mkdir = vi.fn(async () => {}); return { ...original, mkdir, default: { ...original, mkdir } }; });
vi.mock('../../../../apps/chord/main/window', () => ({ createMainWindow: () => mocks.createWindow() }));
vi.mock('../../../../apps/chord/main/user-data', () => ({ resolveUserData: () => ({ name: 'Synthetic Chord', dir: '/synthetic' }) }));
vi.mock('../../../../apps/chord/main/application-menu', () => ({ installApplicationMenu: (deps: any) => { mocks.menu = deps; },
  rebuildRecentMenu: vi.fn(), setEditableFocus: vi.fn(), RELEASES_URL: 'https://github.com/IT-PSAPE/LumaCast/releases' }));
vi.mock('../../../../apps/chord/main/project-io', () => ({ PROJECT_DIALOG_FILTERS: [],
  RecentProjectsStore: class { list = async () => []; push = async () => []; },
  readProjectFile: vi.fn(), writeProjectFile: vi.fn(), readTextFileWithLimit: vi.fn(), writeTextFile: vi.fn(),
}));
vi.mock('../../../../apps/chord/main/export-sink', () => ({ ExportSinkRegistry: class {
  open = vi.fn(async (path: string) => ({ id: 'synthetic-sink', path })); write = vi.fn(); close = vi.fn(); abort = vi.fn(); retire = vi.fn(async () => {});
  constructor() { mocks.registries.push(this); }
} }));

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function event() { return { preventDefault: vi.fn() }; }
function invoke(window: any, channel: string, ...args: any[]) {
  return mocks.handlers.get(channel)!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, ...args);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  mocks.windows = []; mocks.handlers.clear(); mocks.registries = []; mocks.menu = null;
  const app = Object.assign(new EventEmitter(), { isPackaged: false, isReady: () => true,
    getPath: () => '/synthetic', setName: vi.fn(), setPath: vi.fn(), requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(), setAboutPanelOptions: vi.fn(), getVersion: () => '0.0.0',
    quit: vi.fn(), exit: vi.fn() });
  mocks.app = app;
  mocks.createWindow = () => {
    const webContents = Object.assign(new EventEmitter(), { mainFrame: {}, send: vi.fn() });
    const emitter = new EventEmitter();
    const window = Object.assign(emitter, { webContents, destroyed: false,
      isDestroyed() { return this.destroyed; }, show: vi.fn(), focus: vi.fn(), setTitle: vi.fn(), setDocumentEdited: vi.fn(),
      close() {
        const request = event();
        emitter.emit('close', request);
        if (!request.preventDefault.mock.calls.length) {
          this.destroyed = true;
          webContents.emit('destroyed');
          emitter.emit('closed');
        }
      } });
    mocks.windows.push(window);
    return window;
  };
  await import('../../../../apps/chord/main/index');
  await flush();
});

describe('actual Chord main navigation wiring', () => {
  it('delivers the latest cold OS path only after mounted renderer readiness', async () => {
    const window = mocks.windows[0];
    mocks.app.emit('open-file', event(), '/synthetic/first.lumachord');
    mocks.app.emit('open-file', event(), '/synthetic/latest.lumachord');
    window.webContents.emit('did-finish-load');
    expect(window.webContents.send).not.toHaveBeenCalled();
    await invoke(window, IPC_CHANNELS.documentNavigationReady);
    expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(OPEN_PROJECT_REQUEST_CHANNEL, '/synthetic/latest.lumachord');
  });

  it('routes menu and Open Recent through renderer intents, without main file reads', async () => {
    const window = mocks.windows[0];
    await invoke(window, IPC_CHANNELS.documentNavigationReady);
    mocks.menu.emit('new'); mocks.menu.emit('open');
    mocks.menu.onOpenRecent('/synthetic/recent.lumachord');
    expect(window.webContents.send.mock.calls).toEqual([
      [MENU_COMMAND_CHANNEL, 'new'], [MENU_COMMAND_CHANNEL, 'open'], [OPEN_PROJECT_REQUEST_CHANNEL, '/synthetic/recent.lumachord'],
    ]);
  });

  it('an immediate native close is vetoed and queued until renderer readiness', async () => {
    const window = mocks.windows[0];
    window.close();
    expect(window.destroyed).toBe(false);
    expect(window.webContents.send).not.toHaveBeenCalled();
    await invoke(window, IPC_CHANNELS.documentNavigationReady);
    expect(window.webContents.send).toHaveBeenCalledWith(MENU_COMMAND_CHANNEL, 'close');
    await invoke(window, IPC_CHANNELS.requestWindowClose, false);
    expect(mocks.registries[0].retire).not.toHaveBeenCalled();
    expect(() => mocks.handlers.get(IPC_CHANNELS.requestWindowClose)!({ sender: window.webContents, senderFrame: {} }, true)).toThrow('Invalid IPC sender');
  });

  it('approved close waits drain and retires old ownership before a successor opens', async () => {
    const window = mocks.windows[0];
    const draining = deferred();
    mocks.registries[0].retire.mockImplementation(() => draining.promise);
    await invoke(window, IPC_CHANNELS.documentNavigationReady);
    window.close();
    const close = invoke(window, IPC_CHANNELS.requestWindowClose, true);
    await flush();
    expect(window.destroyed).toBe(false);
    draining.resolve();
    expect(await close).toBe(true);
    await flush();
    mocks.app.emit('activate');
    await flush();
    expect(mocks.windows).toHaveLength(2);
    const successor = mocks.windows[1];
    await invoke(successor, IPC_CHANNELS.documentNavigationReady);
    expect(() => invoke(window, IPC_CHANNELS.requestWindowClose, true)).toThrow('Invalid IPC sender');
    window.webContents.emit('destroyed');
    expect(mocks.registries.at(-1).retire).not.toHaveBeenCalled();
    mocks.menu.onOpenRecent('/synthetic/new-owner.lumachord');
    expect(successor.webContents.send).toHaveBeenCalledWith(OPEN_PROJECT_REQUEST_CHANNEL, '/synthetic/new-owner.lumachord');
  });

  it('quit cancellation preserves exports and successful quit awaits the allowed drain', async () => {
    const window = mocks.windows[0];
    await invoke(window, IPC_CHANNELS.documentNavigationReady);
    const canceled = event();
    mocks.app.emit('before-quit', canceled);
    expect(canceled.preventDefault).toHaveBeenCalled();
    await invoke(window, IPC_CHANNELS.requestWindowClose, false);
    expect(mocks.registries[0].retire).not.toHaveBeenCalled();
    const draining = deferred();
    mocks.registries[0].retire.mockImplementation(() => draining.promise);
    mocks.app.emit('before-quit', event());
    const closing = invoke(window, IPC_CHANNELS.requestWindowClose, true);
    await flush();
    expect(mocks.app.quit).not.toHaveBeenCalled();
    draining.resolve();
    await closing;
    await flush();
    expect(mocks.app.quit).toHaveBeenCalledOnce();
  });

  it('a fresh window cannot admit exports before its destroyed predecessor drains', async () => {
    const window = mocks.windows[0];
    await invoke(window, IPC_CHANNELS.documentNavigationReady);
    const draining = deferred();
    mocks.registries[0].retire.mockImplementation(() => draining.promise);
    window.destroyed = true;
    window.webContents.emit('destroyed');
    window.emit('closed');
    mocks.app.emit('activate');
    await flush();
    expect(mocks.windows).toHaveLength(1);
    expect(mocks.registries).toHaveLength(1);
    draining.resolve();
    await flush();
    expect(mocks.windows).toHaveLength(2);
    const successor = mocks.windows[1];
    await invoke(successor, IPC_CHANNELS.documentNavigationReady);
    await invoke(successor, IPC_CHANNELS.exportOpen, '/synthetic/export.mp4');
    expect(mocks.registries[1].open).toHaveBeenCalledWith('/synthetic/export.mp4');
    expect(mocks.registries[0].open).not.toHaveBeenCalled();
  });

  it('Quit supersedes an already-waiting activate without reopening a drained successor', async () => {
    const window = mocks.windows[0];
    await invoke(window, IPC_CHANNELS.documentNavigationReady);
    const draining = deferred();
    mocks.registries[0].retire.mockImplementation(() => draining.promise);
    window.destroyed = true;
    window.webContents.emit('destroyed');
    window.emit('closed');
    mocks.app.emit('activate');
    await flush();
    mocks.app.emit('before-quit', event());
    expect(mocks.windows).toHaveLength(1);
    draining.resolve();
    await flush();
    expect(mocks.windows).toHaveLength(1);
    expect(mocks.app.quit).toHaveBeenCalledOnce();
  });
});
