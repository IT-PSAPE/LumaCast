import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';

vi.mock('electron', () => ({
  app: { showAboutPanel: vi.fn() },
  Menu: { buildFromTemplate: vi.fn((template: unknown) => template), setApplicationMenu: vi.fn() },
}));

import {
  buildApplicationMenuTemplate,
  type ApplicationMenuDeps,
} from '../../../../apps/flux/main/application-menu';

function makeDeps(overrides: Partial<ApplicationMenuDeps> = {}): ApplicationMenuDeps {
  return { platform: 'darwin', isPackaged: false, emit: vi.fn(), ...overrides };
}

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
  ]);
}

describe('apps/flux application menu', () => {
  it('hides Reload, Force Reload and DevTools when packaged', () => {
    const roles = flatten(buildApplicationMenuTemplate(makeDeps({ isPackaged: true }))).map((i) => i.role);
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forceReload');
    expect(roles).not.toContain('toggleDevTools');
  });

  it('shows them in development', () => {
    const roles = flatten(buildApplicationMenuTemplate(makeDeps())).map((i) => i.role);
    expect(roles).toEqual(expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools']));
  });

  it('maps File and Edit items to commands with primary-modifier accelerators', () => {
    const deps = makeDeps();
    const items = flatten(buildApplicationMenuTemplate(deps));
    const byLabel = (label: string) => items.find((i) => i.label === label)!;
    expect(byLabel('Export…').accelerator).toBe('CmdOrCtrl+E');
    expect(byLabel('Undo').accelerator).toBe('CmdOrCtrl+Z');
    byLabel('Import Photos…').click!({} as never, undefined, {} as never);
    byLabel('Redo').click!({} as never, undefined, {} as never);
    expect(deps.emit).toHaveBeenCalledWith('import-photos');
    expect(deps.emit).toHaveBeenCalledWith('redo');
  });

  it('never registers a bare-key accelerator app-wide', () => {
    const bare = flatten(buildApplicationMenuTemplate(makeDeps())).filter(
      (i) => i.accelerator && !String(i.accelerator).includes('+'),
    );
    expect(bare.length).toBeGreaterThanOrEqual(9);
    for (const item of bare) expect(item.registerAccelerator).toBe(false);
  });

  it('puts Quit and About where each platform expects them', () => {
    const mac = buildApplicationMenuTemplate(makeDeps({ platform: 'darwin' }));
    expect(mac[0].label).toBe('Lumaflux');
    const win = buildApplicationMenuTemplate(makeDeps({ platform: 'win32' }));
    expect(win.map((m) => m.label)).toEqual(['File', 'Edit', 'Photo', 'View', 'Window', 'Help']);
    expect(flatten(win).some((i) => i.role === 'quit')).toBe(true);
  });
});
