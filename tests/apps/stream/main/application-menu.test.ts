import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';

// apps/stream has its own node_modules/electron, so the source under test
// resolves to a different module id than the root one; mock both.
const electronModule = vi.hoisted(() => {
  const buildFromTemplate = vi.fn((template: unknown) => ({ __template: template }));
  const setApplicationMenu = vi.fn();
  const getFocusedWebContents = vi.fn(() => null as unknown);
  return {
    app: { name: 'LumaStream' },
    Menu: { buildFromTemplate, setApplicationMenu },
    webContents: { getFocusedWebContents },
  };
});
vi.mock('electron', () => electronModule);
vi.mock('../../../../apps/stream/node_modules/electron/index.js', () => electronModule);

import { Menu, webContents } from 'electron';
import { applyApplicationMenu, validateSerializedMenu } from '../../../../apps/stream/main/application-menu';
import type { SerializedMenuItem } from '../../../../apps/stream/renderer/chrome/app-menu';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

afterEach(() => {
  setPlatform(originalPlatform);
  vi.mocked(Menu.buildFromTemplate).mockClear();
  vi.mocked(Menu.setApplicationMenu).mockClear();
  vi.mocked(webContents.getFocusedWebContents).mockReset();
  vi.mocked(webContents.getFocusedWebContents).mockReturnValue(null as never);
});

function lastTemplate(): MenuItemConstructorOptions[] {
  const calls = vi.mocked(Menu.buildFromTemplate).mock.calls;
  return calls[calls.length - 1]![0] as MenuItemConstructorOptions[];
}

function findTop(id: string): MenuItemConstructorOptions {
  const item = lastTemplate().find((candidate) => candidate.id === id);
  if (!item) throw new Error(`top-level menu item not found: ${id}`);
  return item;
}

function makeEditTemplate(overrides: Partial<SerializedMenuItem> = {}): SerializedMenuItem[] {
  return [
    {
      id: 'edit',
      label: 'Edit',
      type: 'submenu',
      submenu: [
        { id: 'edit.undo', label: 'Undo', accelerator: 'CommandOrControl+Z' },
        { id: 'edit.redo', label: 'Redo', accelerator: 'Shift+CommandOrControl+Z' },
        { id: 'edit.separator-0', label: '', type: 'separator' },
        { id: 'edit.copy', label: 'Copy', accelerator: 'CommandOrControl+C' },
        { id: 'edit.paste', label: 'Paste', accelerator: 'CommandOrControl+V' },
        { id: 'edit.delete', label: 'Delete', accelerator: 'Delete', registerAccelerator: false },
      ],
      ...overrides,
    },
  ];
}

describe('validateSerializedMenu', () => {
  it('accepts a well-formed template', () => {
    const template: SerializedMenuItem[] = [
      { id: 'file', label: 'File', type: 'submenu', submenu: [{ id: 'file.quit', label: 'Quit', accelerator: 'CommandOrControl+Q' }] },
    ];
    expect(validateSerializedMenu(template)).toEqual(template);
  });

  it('rejects a non-array payload', () => {
    expect(() => validateSerializedMenu({ not: 'an array' })).toThrow();
    expect(() => validateSerializedMenu(null)).toThrow();
  });

  it('rejects an item missing id or label', () => {
    expect(() => validateSerializedMenu([{ label: 'File' }])).toThrow();
    expect(() => validateSerializedMenu([{ id: 'file' }])).toThrow();
  });

  it('rejects an unknown field', () => {
    expect(() => validateSerializedMenu([{ id: 'file', label: 'File', dangerous: true }])).toThrow();
  });

  it('rejects an invalid type or role', () => {
    expect(() => validateSerializedMenu([{ id: 'file', label: 'File', type: 'weird' }])).toThrow();
    expect(() => validateSerializedMenu([{ id: 'file', label: 'File', role: 'launchNukes' }])).toThrow();
  });

  it('rejects an oversized label or accelerator', () => {
    expect(() => validateSerializedMenu([{ id: 'file', label: 'x'.repeat(201) }])).toThrow();
    expect(() => validateSerializedMenu([{ id: 'file', label: 'File', accelerator: 'x'.repeat(65) }])).toThrow();
  });

  it('rejects nesting deeper than 4 levels', () => {
    let node: SerializedMenuItem = { id: 'depth-5', label: 'Deep' };
    for (let depth = 0; depth < 4; depth += 1) {
      node = { id: `depth-${depth}`, label: 'Wrap', type: 'submenu', submenu: [node] };
    }
    expect(() => validateSerializedMenu([node])).toThrow();
  });

  it('accepts exactly 4 levels of nesting', () => {
    const node: SerializedMenuItem = {
      id: 'l1', label: 'L1', type: 'submenu', submenu: [
        { id: 'l2', label: 'L2', type: 'submenu', submenu: [
          { id: 'l3', label: 'L3', type: 'submenu', submenu: [
            { id: 'l4', label: 'L4' },
          ] },
        ] },
      ],
    };
    expect(() => validateSerializedMenu([node])).not.toThrow();
  });

  it('rejects more than 200 items total', () => {
    const submenu: SerializedMenuItem[] = Array.from({ length: 200 }, (_, index) => ({ id: `item-${index}`, label: `Item ${index}` }));
    expect(() => validateSerializedMenu([{ id: 'root', label: 'Root', type: 'submenu', submenu }])).toThrow();
  });

  it('allows up to 200 items total', () => {
    const submenu: SerializedMenuItem[] = Array.from({ length: 199 }, (_, index) => ({ id: `item-${index}`, label: `Item ${index}` }));
    expect(() => validateSerializedMenu([{ id: 'root', label: 'Root', type: 'submenu', submenu }])).not.toThrow();
  });

  it('drops fields it does not recognize by only copying known ones through', () => {
    const result = validateSerializedMenu([{ id: 'docks.scenes', label: 'Scenes', type: 'checkbox', checked: true }]);
    expect(result).toEqual([{ id: 'docks.scenes', label: 'Scenes', type: 'checkbox', checked: true }]);
  });
});

describe('applyApplicationMenu', () => {
  it('clears the menu on non-darwin platforms without building a template', () => {
    setPlatform('win32');
    const send = vi.fn();
    applyApplicationMenu([{ id: 'file', label: 'File' }], send);
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
  });

  it('clears the menu on linux too', () => {
    setPlatform('linux');
    applyApplicationMenu([], vi.fn());
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith(null);
  });

  describe('on darwin', () => {
    it('installs a native App menu first, the provided menus next, and a windowMenu role last', () => {
      setPlatform('darwin');
      applyApplicationMenu([{ id: 'file', label: 'File', type: 'submenu', submenu: [] }], vi.fn());
      const template = lastTemplate();
      expect(template[0]!.label).toBe('LumaStream');
      expect(template[1]!.id).toBe('file');
      expect(template[template.length - 1]).toEqual({ role: 'windowMenu' });
      expect(Menu.setApplicationMenu).toHaveBeenCalledWith(expect.objectContaining({ __template: template }));
    });

    it('builds the App menu with About/Settings and the standard services/hide/quit roles, in order', () => {
      setPlatform('darwin');
      applyApplicationMenu([], vi.fn());
      const submenu = lastTemplate()[0]!.submenu as MenuItemConstructorOptions[];
      expect(submenu[0]).toMatchObject({ id: 'help.about', label: 'About LumaStream' });
      expect(submenu[1]).toEqual({ type: 'separator' });
      expect(submenu[2]).toMatchObject({ id: 'file.settings', label: 'Settings…', accelerator: 'Cmd+,' });
      expect(submenu.map((item) => item.role)).toEqual([
        undefined, undefined, undefined, undefined, 'services', undefined, 'hide', 'hideOthers', 'unhide', undefined, 'quit',
      ]);
    });

    it('fires the About and Settings items by sending their id', () => {
      setPlatform('darwin');
      const send = vi.fn();
      applyApplicationMenu([], send);
      const submenu = lastTemplate()[0]!.submenu as MenuItemConstructorOptions[];
      submenu.find((item) => item.id === 'help.about')!.click!(undefined as never, undefined, undefined as never);
      submenu.find((item) => item.id === 'file.settings')!.click!(undefined as never, undefined, undefined as never);
      expect(send).toHaveBeenNthCalledWith(1, 'help.about');
      expect(send).toHaveBeenNthCalledWith(2, 'file.settings');
    });

    it('converts a plain item to a clickable template entry that sends its id', () => {
      setPlatform('darwin');
      const send = vi.fn();
      applyApplicationMenu([{ id: 'help', label: 'Help', type: 'submenu', submenu: [{ id: 'help.shortcuts', label: 'Keyboard Shortcuts…' }] }], send);
      const help = findTop('help');
      const shortcuts = (help.submenu as MenuItemConstructorOptions[])[0]!;
      expect(shortcuts.label).toBe('Keyboard Shortcuts…');
      shortcuts.click!(undefined as never, undefined, undefined as never);
      expect(send).toHaveBeenCalledWith('help.shortcuts');
    });

    it('passes through checkbox/radio type, checked, accelerator, registerAccelerator, and disabled->enabled', () => {
      setPlatform('darwin');
      applyApplicationMenu([
        {
          id: 'docks',
          label: 'Docks',
          type: 'submenu',
          submenu: [
            { id: 'docks.scenes', label: 'Scenes', type: 'checkbox', checked: true },
            { id: 'docks.youtube', label: 'YouTube', type: 'checkbox', checked: false, disabled: true },
            { id: 'edit.transform.fit', label: 'Fit to Screen', accelerator: 'CommandOrControl+F', registerAccelerator: false },
          ],
        },
      ], vi.fn());
      const docks = findTop('docks').submenu as MenuItemConstructorOptions[];
      expect(docks[0]).toMatchObject({ type: 'checkbox', checked: true });
      expect(docks[1]).toMatchObject({ type: 'checkbox', checked: false, enabled: false });
      expect(docks[2]).toMatchObject({ accelerator: 'CommandOrControl+F', registerAccelerator: false });
    });

    it('passes separators through untouched', () => {
      setPlatform('darwin');
      applyApplicationMenu([{ id: 'file', label: 'File', type: 'submenu', submenu: [{ id: 'file.sep-0', label: '', type: 'separator' }] }], vi.fn());
      expect((findTop('file').submenu as MenuItemConstructorOptions[])[0]).toEqual({ type: 'separator' });
    });

    it('appends Cut and Select All roles to the Edit submenu', () => {
      setPlatform('darwin');
      applyApplicationMenu(makeEditTemplate(), vi.fn());
      const edit = findTop('edit').submenu as MenuItemConstructorOptions[];
      const roles = edit.map((item) => item.role);
      expect(roles).toContain('cut');
      expect(roles).toContain('selectAll');
      expect(edit[edit.length - 2]).toMatchObject({ role: 'cut' });
      expect(edit[edit.length - 1]).toMatchObject({ role: 'selectAll' });
    });

    it('does not attach a click handler to role items (Electron ignores click when role is set)', () => {
      setPlatform('darwin');
      applyApplicationMenu(makeEditTemplate(), vi.fn());
      const edit = findTop('edit').submenu as MenuItemConstructorOptions[];
      const cut = edit.find((item) => item.role === 'cut')!;
      expect(cut.click).toBeUndefined();
    });

    it('dual-handles Undo/Redo/Copy/Paste: calls the focused webContents method and still sends the id', () => {
      setPlatform('darwin');
      const focused = { undo: vi.fn(), redo: vi.fn(), copy: vi.fn(), paste: vi.fn() };
      vi.mocked(webContents.getFocusedWebContents).mockReturnValue(focused as never);
      const send = vi.fn();
      applyApplicationMenu(makeEditTemplate(), send);
      const edit = findTop('edit').submenu as MenuItemConstructorOptions[];

      edit.find((item) => item.id === 'edit.undo')!.click!(undefined as never, undefined, undefined as never);
      edit.find((item) => item.id === 'edit.redo')!.click!(undefined as never, undefined, undefined as never);
      edit.find((item) => item.id === 'edit.copy')!.click!(undefined as never, undefined, undefined as never);
      edit.find((item) => item.id === 'edit.paste')!.click!(undefined as never, undefined, undefined as never);

      expect(focused.undo).toHaveBeenCalledTimes(1);
      expect(focused.redo).toHaveBeenCalledTimes(1);
      expect(focused.copy).toHaveBeenCalledTimes(1);
      expect(focused.paste).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('edit.undo');
      expect(send).toHaveBeenCalledWith('edit.redo');
      expect(send).toHaveBeenCalledWith('edit.copy');
      expect(send).toHaveBeenCalledWith('edit.paste');
    });

    it('tolerates no focused webContents for the dual-handled edit actions', () => {
      setPlatform('darwin');
      vi.mocked(webContents.getFocusedWebContents).mockReturnValue(null as never);
      const send = vi.fn();
      applyApplicationMenu(makeEditTemplate(), send);
      const edit = findTop('edit').submenu as MenuItemConstructorOptions[];
      expect(() => edit.find((item) => item.id === 'edit.undo')!.click!(undefined as never, undefined, undefined as never)).not.toThrow();
      expect(send).toHaveBeenCalledWith('edit.undo');
    });
  });
});
