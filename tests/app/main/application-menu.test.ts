import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import type { AppMenuState } from '@lumacast/commands';

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
} from '../../../app/main/application-menu';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function makeState(overrides: Partial<AppMenuState> = {}): AppMenuState {
  return {
    workbenchMode: 'show',
    slideBrowserMode: 'grid',
    hasCurrentPlaylist: false,
    hasCurrentItem: false,
    hasCurrentSlide: false,
    hasMultipleSlides: false,
    hasEditableSelection: false,
    canUndo: false,
    canRedo: false,
    canCut: false,
    canCopy: false,
    canPaste: false,
    hasEditableFocus: false,
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

function flattenMenuItems(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = [];
  const walk = (list: MenuItemConstructorOptions[]) => {
    for (const item of list) {
      out.push(item);
      if (Array.isArray(item.submenu)) walk(item.submenu as MenuItemConstructorOptions[]);
    }
  };
  walk(items);
  return out;
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
  it('offers Grid/List for slide content without a playlist-layout submenu', () => {
    createApplicationMenu();

    const labels = flattenMenuItems(lastTemplate()).map((item) => item.label);
    expect(labels).toContain('Slide Browser Layout');
    expect(labels).not.toContain('Playlist Layout');
    expect(labels).not.toContain('Current');
    expect(labels).not.toContain('Tabs');
    expect(labels).not.toContain('Continuous');
  });

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

// registerAccelerator is a Linux/Windows-only Electron field: setting it to
// false stops the native menu from registering its own accelerator, which is
// what prevents double dispatch on those platforms (the renderer keydown
// handler runs its shortcut, so the menu must not also trigger it). macOS
// does not use this field; instead it additionally needs the renderer-side
// claim registry in @lumacast/commands to drop the duplicate native menu IPC
// that Electron still delivers after the keydown handler runs.
describe('registerAccelerator threading', () => {
  const UNREGISTERED_LABELS = [
    'Undo',
    'Redo',
    'Cut',
    'Copy',
    'Paste',
    'Duplicate',
    'Delete',
    'Select None',
    'Command Palette…',
    'Take Slide',
    'Previous Slide',
    'Next Slide',
  ];

  it.each(['darwin', 'win32'])(
    'unregisters every menu item whose accelerator collides with a renderer shortcut (%s)',
    (platform) => {
      setPlatform(platform as NodeJS.Platform);
      createApplicationMenu();

      const labels = flattenMenuItems(lastTemplate())
        .filter((item) => item.registerAccelerator === false)
        .map((item) => item.label);

      expect(labels).toEqual(UNREGISTERED_LABELS);
    },
  );

  it.each(['darwin', 'win32'])(
    'leaves the three menu-owned accelerators registered because the renderer has no shortcut for them (%s)',
    (platform) => {
      setPlatform(platform as NodeJS.Platform);
      createApplicationMenu();

      const owned = flattenMenuItems(lastTemplate()).filter((item) =>
        item.accelerator !== undefined && (
          item.label === 'New Presentation' ||
          item.label === 'New Slide' ||
          item.label === 'Settings'
        ),
      );

      expect(owned).toHaveLength(3);
      for (const item of owned) {
        expect(item.registerAccelerator).toBeUndefined();
      }
    },
  );

  it('applicationMenuDescriptorsEqual reports unequal when only registerAccelerator differs', () => {
    expect(applicationMenuDescriptorsEqual(
      descriptor([{ commandId: 'edit.undo', registerAccelerator: false }]),
      descriptor([{ commandId: 'edit.undo', registerAccelerator: true }]),
    )).toBe(false);
  });
});

// A focused text field owns its editing chords, and on macOS Chromium only
// performs them when the Edit menu item bound to the chord is the native
// role (its `paste:`/`copy:` selector reaches the field). An app command on
// the same chord swallows the keystroke instead — the paste-into-text-box
// regression — so the Edit menu swaps to roles for the duration of the focus.
describe('editable focus swaps the Edit menu to native roles', () => {
  const NATIVE_TEXT_ROLES = ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll'];
  const APP_EDIT_COMMANDS = ['edit.undo', 'edit.redo', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.delete'];

  function editSubmenu(): MenuItemConstructorOptions[] {
    const edit = lastTemplate().find((item) => item.id === 'edit');
    return (edit?.submenu ?? []) as MenuItemConstructorOptions[];
  }

  function commandIdsOf(items: MenuItemConstructorOptions[]): string[] {
    // Command items are the ones with a click handler and no role.
    return items.filter((item) => item.click && !item.role).map((item) => item.label ?? '');
  }

  it.each(['darwin', 'win32'])('uses native roles for every text-editing chord while a field has focus (%s)', (platform) => {
    setPlatform(platform as NodeJS.Platform);
    createApplicationMenu(null, makeState({ hasEditableFocus: true }));

    const roles = editSubmenu().map((item) => item.role).filter((role): role is NonNullable<typeof role> => role !== undefined);
    for (const role of NATIVE_TEXT_ROLES) expect(roles).toContain(role);
    // No app command may still sit on a text-editing chord.
    const labels = commandIdsOf(editSubmenu());
    for (const label of ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete']) expect(labels).not.toContain(label);
    // The rest of the menu keeps its shape: Duplicate/Select None disabled, palette still reachable.
    const duplicate = editSubmenu().find((item) => item.label === 'Duplicate');
    expect(duplicate?.enabled).toBe(false);
    expect(editSubmenu().some((item) => item.label === 'Command Palette…')).toBe(true);
  });

  it('keeps the app commands (with unregistered accelerators) when no field has focus', () => {
    setPlatform('darwin');
    createApplicationMenu(null, makeState({ hasEditableFocus: false, canPaste: true }));

    const paste = editSubmenu().find((item) => item.label === 'Paste');
    expect(paste?.role).toBeUndefined();
    expect(paste?.registerAccelerator).toBe(false);
    expect(paste?.enabled).toBe(true);
    expect(editSubmenu().some((item) => item.role === 'paste')).toBe(false);
    // Sanity: the full app-command set is present.
    expect(commandIdsOf(editSubmenu()).length).toBeGreaterThanOrEqual(APP_EDIT_COMMANDS.length);
  });

  it('rebuilds exactly once when focus moves into and out of a text field', () => {
    const window = makeWindow(7);

    updateApplicationMenu(window, makeState());
    updateApplicationMenu(window, makeState({ hasEditableFocus: true }));
    updateApplicationMenu(window, makeState({ hasEditableFocus: true }));
    updateApplicationMenu(window, makeState());

    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(3);
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

    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/IT-PSAPE/LumaCast');
  });

  it('preserves dynamic enabled state in the built template', () => {
    updateApplicationMenu(makeWindow(7), makeState({ hasCurrentItem: true, canExportWorkspace: true }));

    const template = lastTemplate();
    const fileMenu = template.find((item) => item.id === 'file')!;
    const fileSubmenu = fileMenu.submenu as MenuItemConstructorOptions[];
    const exportCurrent = fileSubmenu.find((item) => item.label === 'Export Current Item…')!;
    const exportWorkspace = fileSubmenu.find((item) => item.label === 'Export Workspace…')!;

    expect(exportCurrent.enabled).toBe(true);
    expect(exportWorkspace.enabled).toBe(true);
  });
});
