import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import type { AppMenuState } from '@core/ipc';

vi.mock('electron', () => {
  const buildFromTemplate = vi.fn((template: unknown) => template);
  const setApplicationMenu = vi.fn();
  return {
    app: { isPackaged: false },
    BrowserWindow: { getFocusedWindow: vi.fn(() => null) },
    Menu: {
      buildFromTemplate,
      setApplicationMenu,
      getApplicationMenu: vi.fn(() => null),
    },
    shell: { openExternal: vi.fn() },
  };
});

import { app, BrowserWindow, Menu, shell } from 'electron';
import {
  applicationMenuDescriptorsEqual,
  createApplicationMenu,
  getApplicationMenuDiagnostics,
  resetApplicationMenuState,
  updateApplicationMenu,
  type ApplicationMenuDescriptor,
  type SerializableMenuItem,
} from './application-menu';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function makeState(overrides: Partial<AppMenuState> = {}): AppMenuState {
  return {
    workbenchMode: 'show',
    slideBrowserMode: 'grid',
    playlistBrowserMode: 'current',
    hasCurrentLibrary: false,
    hasCurrentPlaylist: false,
    hasCurrentDeckItem: false,
    hasCurrentSlide: false,
    hasMultipleSlides: false,
    hasEditableSelection: false,
    canUndo: false,
    canRedo: false,
    canCut: false,
    canCopy: false,
    canPaste: false,
    canDuplicate: false,
    canDelete: false,
    canClearSelection: false,
    canTakeSlide: false,
    canGoToPreviousSlide: false,
    canGoToNextSlide: false,
    canExportWorkspace: false,
    audienceOutputEnabled: false,
    stageOutputEnabled: false,
    ...overrides,
  };
}

function makeWindow(id = 7) {
  return {
    isDestroyed: () => false,
    webContents: { id, send: vi.fn() },
  } as unknown as BrowserWindow;
}

function descriptor(items: SerializableMenuItem[], webContentsId: number | null = 7): ApplicationMenuDescriptor {
  return { webContentsId, items };
}

function lastTemplate(): MenuItemConstructorOptions[] {
  const calls = vi.mocked(Menu.buildFromTemplate).mock.calls;
  return calls[calls.length - 1][0] as MenuItemConstructorOptions[];
}

function invokeClick(item: MenuItemConstructorOptions): void {
  (item.click as (() => void) | undefined)?.();
}

beforeEach(() => {
  resetApplicationMenuState();
  vi.mocked(Menu.setApplicationMenu).mockClear();
  vi.mocked(Menu.buildFromTemplate).mockClear();
  vi.mocked(BrowserWindow.getFocusedWindow).mockReset();
  vi.mocked(shell.openExternal).mockClear();
});

afterEach(() => {
  setPlatform(originalPlatform);
  (app as unknown as { isPackaged: boolean }).isPackaged = false;
});

describe('applicationMenuDescriptorsEqual', () => {
  it('treats structurally identical descriptors as equal regardless of object identity', () => {
    const item = (): SerializableMenuItem => ({ id: 'file', label: 'File', submenu: [{ commandId: 'file.newPresentation', label: 'New Presentation' }] });
    expect(applicationMenuDescriptorsEqual(descriptor([item()]), descriptor([item()]))).toBe(true);
  });

  it('reports unequal when the label changes', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([{ commandId: 'file.newPresentation', label: 'New Presentation' }]),
      descriptor([{ commandId: 'file.newPresentation', label: 'New Slide' }]),
    )).toBe(false);
  });

  it('reports unequal when the accelerator changes', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([{ commandId: 'file.newPresentation', accelerator: 'CmdOrCtrl+N' }]),
      descriptor([{ commandId: 'file.newPresentation', accelerator: 'CmdOrCtrl+Shift+N' }]),
    )).toBe(false);
  });

  it('reports unequal when the enabled state changes', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([{ commandId: 'edit.undo', enabled: false }]),
      descriptor([{ commandId: 'edit.undo', enabled: true }]),
    )).toBe(false);
  });

  it('reports unequal when the visible state changes', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([{ id: 'x', visible: false }]),
      descriptor([{ id: 'x', visible: true }]),
    )).toBe(false);
  });

  it('reports unequal when the checked state changes', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([{ commandId: 'view.mode.show', type: 'radio', checked: true }]),
      descriptor([{ commandId: 'view.mode.show', type: 'radio', checked: false }]),
    )).toBe(false);
  });

  it('reports unequal when the role changes', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([{ role: 'close' }]),
      descriptor([{ role: 'quit' }]),
    )).toBe(false);
  });

  it('reports unequal when the item type changes', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([{ type: 'separator' }]),
      descriptor([{ type: 'checkbox' }]),
    )).toBe(false);
  });

  it('reports unequal when submenu order changes', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([{ id: 'view', submenu: [{ label: 'A' }, { label: 'B' }] }]),
      descriptor([{ id: 'view', submenu: [{ label: 'B' }, { label: 'A' }] }]),
    )).toBe(false);
  });

  it('reports unequal when nesting depth changes', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([{ id: 'view', submenu: [{ label: 'A' }] }]),
      descriptor([{ id: 'view', submenu: [{ label: 'A', submenu: [{ label: 'B' }] }] }]),
    )).toBe(false);
  });

  it('reports unequal when the target webContents id changes', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([], 1),
      descriptor([], 2),
    )).toBe(false);
  });
});

describe('createApplicationMenu', () => {
  it('builds the top-level template for the default state', () => {
    setPlatform('darwin');

    createApplicationMenu();

    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0][0] as MenuItemConstructorOptions[];
    expect(template.map((item) => item.label ?? item.role ?? item.type)).toEqual([
      'appMenu',
      'File',
      'Edit',
      'View',
      'Playback',
      'Window',
      'Help',
    ]);
  });

  it('includes platform roles in the file menu', () => {
    setPlatform('darwin');
    createApplicationMenu();

    const template = lastTemplate();
    const fileMenu = template.find((item) => item.id === 'file')!;
    const fileSubmenu = fileMenu.submenu as MenuItemConstructorOptions[];
    expect(fileSubmenu[fileSubmenu.length - 1]).toEqual({ role: 'close' });
  });
});

describe('updateApplicationMenu', () => {
  it('skips a rebuild when the description is identical', () => {
    const window = makeWindow(7);
    const state = makeState();

    updateApplicationMenu(window, state);
    updateApplicationMenu(window, state);

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
  });

  it('does not rebuild when only object identity changes', () => {
    const window = makeWindow(7);

    updateApplicationMenu(window, makeState());
    updateApplicationMenu(window, makeState({ canUndo: false }));

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
  });

  it('rebuilds exactly once when the enabled state changes', () => {
    const window = makeWindow(7);

    updateApplicationMenu(window, makeState());
    updateApplicationMenu(window, makeState({ canUndo: true }));
    updateApplicationMenu(window, makeState({ canUndo: true }));

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(2);
  });

  it('rebuilds exactly once when the checked state changes', () => {
    const window = makeWindow(7);

    updateApplicationMenu(window, makeState({ workbenchMode: 'show' }));
    updateApplicationMenu(window, makeState({ workbenchMode: 'theme-editor' }));

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when the target webContents id changes', () => {
    updateApplicationMenu(makeWindow(1), makeState());
    updateApplicationMenu(makeWindow(2), makeState());

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when platform-specific roles change', () => {
    const window = makeWindow(7);
    const state = makeState();

    setPlatform('darwin');
    updateApplicationMenu(window, state);
    setPlatform('win32');
    updateApplicationMenu(window, state);

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(2);
  });

  it('records requested and actual rebuild counts across a rapid burst', () => {
    const window = makeWindow(7);
    const state = makeState();

    updateApplicationMenu(window, state);
    updateApplicationMenu(window, state);
    updateApplicationMenu(window, makeState({ canUndo: true }));
    updateApplicationMenu(window, makeState({ canUndo: true }));
    updateApplicationMenu(window, makeState({ workbenchMode: 'theme-editor' }));
    updateApplicationMenu(window, state);

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(4);
    expect(getApplicationMenuDiagnostics()).toEqual({ requestedRebuilds: 6, actualRebuilds: 4 });
  });

  it('logs one structured debug record per actual rebuild', () => {
    const debugSpy = vi.spyOn(console, 'debug');
    const window = makeWindow(7);

    updateApplicationMenu(window, makeState());
    updateApplicationMenu(window, makeState());

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(
      '[application-menu] rebuilt native menu',
      expect.objectContaining({ webContentsId: 7, requestedRebuilds: 1, actualRebuilds: 1 }),
    );
    debugSpy.mockRestore();
  });

  it('does not count or log when packaged', () => {
    (app as unknown as { isPackaged: boolean }).isPackaged = true;
    const debugSpy = vi.spyOn(console, 'debug');
    const window = makeWindow(7);

    updateApplicationMenu(window, makeState());
    updateApplicationMenu(window, makeState());
    updateApplicationMenu(window, makeState({ canUndo: true }));

    expect(getApplicationMenuDiagnostics()).toEqual({ requestedRebuilds: 0, actualRebuilds: 0 });
    expect(debugSpy).not.toHaveBeenCalled();
    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(2);
    debugSpy.mockRestore();
  });

  it('dispatches command items to the captured window', () => {
    const window = makeWindow(7);
    updateApplicationMenu(window, makeState());

    const template = lastTemplate();
    const fileMenu = template.find((item) => item.id === 'file')!;
    const fileSubmenu = fileMenu.submenu as MenuItemConstructorOptions[];
    invokeClick(fileSubmenu[0]);

    expect(window.webContents.send).toHaveBeenCalledWith('app-menu:command', 'file.newPresentation');
  });

  it('dispatches the help check-for-updates item to the focused window', () => {
    const focusedWindow = makeWindow(9);
    vi.mocked(BrowserWindow.getFocusedWindow).mockReturnValue(focusedWindow);

    updateApplicationMenu(makeWindow(7), makeState());

    const template = lastTemplate();
    const helpMenu = template.find((item) => item.id === 'help')!;
    const helpSubmenu = helpMenu.submenu as MenuItemConstructorOptions[];
    invokeClick(helpSubmenu[0]);

    expect(focusedWindow.webContents.send).toHaveBeenCalledWith('app-menu:command', 'app.checkForUpdates');
  });

  it('keeps the learn-more item opening the external website', () => {
    updateApplicationMenu(makeWindow(7), makeState());

    const template = lastTemplate();
    const helpMenu = template.find((item) => item.id === 'help')!;
    const helpSubmenu = helpMenu.submenu as MenuItemConstructorOptions[];
    invokeClick(helpSubmenu[2]);

    expect(shell.openExternal).toHaveBeenCalledWith('https://openai.com');
  });

  it('preserves dynamic enabled state in the built template', () => {
    updateApplicationMenu(makeWindow(7), makeState({ hasCurrentDeckItem: true, canExportWorkspace: true }));

    const template = lastTemplate();
    const fileMenu = template.find((item) => item.id === 'file')!;
    const fileSubmenu = fileMenu.submenu as MenuItemConstructorOptions[];
    const exportCurrent = fileSubmenu.find((item) => item.label === 'Export Current Item…')!;
    const exportWorkspace = fileSubmenu.find((item) => item.label === 'Export Workspace…')!;

    expect(exportCurrent.enabled).toBe(true);
    expect(exportWorkspace.enabled).toBe(true);
  });
});