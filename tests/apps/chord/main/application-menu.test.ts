import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';

vi.mock('electron', () => {
  const buildFromTemplate = vi.fn((template: unknown) => template);
  const setApplicationMenu = vi.fn();
  return {
    app: { showAboutPanel: vi.fn() },
    Menu: { buildFromTemplate, setApplicationMenu },
  };
});

import { Menu } from 'electron';
import {
  buildApplicationMenuTemplate,
  installApplicationMenu,
  rebuildRecentMenu,
  RELEASES_URL,
  type ApplicationMenuDeps,
} from '../../../../apps/chord/main/application-menu';
import type { MenuCommand } from '../../../../apps/chord/shared/desktop-api';
import type { RecentProject } from '../../../../apps/chord/shared/project';

function makeDeps(overrides: Partial<ApplicationMenuDeps> = {}): ApplicationMenuDeps {
  return {
    platform: 'darwin',
    isPackaged: false,
    recentProjects: [],
    emit: vi.fn(),
    onOpenRecent: vi.fn(),
    onOpenReleaseNotes: vi.fn(),
    ...overrides,
  };
}

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
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

function findMenu(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const menu = template.find((item) => item.label === label);
  return (menu?.submenu ?? []) as MenuItemConstructorOptions[];
}

function click(item: MenuItemConstructorOptions | undefined): void {
  (item?.click as (() => void) | undefined)?.();
}

describe('apps/chord buildApplicationMenuTemplate: top-level shape', () => {
  it('puts the app menu first on darwin', () => {
    const template = buildApplicationMenuTemplate(makeDeps({ platform: 'darwin' }));
    expect(template.map((item) => item.label ?? item.role)).toEqual([
      'LumaChord',
      'File',
      'Edit',
      'Timeline',
      'View',
      'Window',
      'Help',
    ]);
  });

  it('has no app menu on win32/linux', () => {
    const template = buildApplicationMenuTemplate(makeDeps({ platform: 'win32' }));
    expect(template.map((item) => item.label ?? item.role)).toEqual([
      'File',
      'Edit',
      'Timeline',
      'View',
      'Window',
      'Help',
    ]);
  });

  it('gives the darwin app menu an about role and a quit role', () => {
    const template = buildApplicationMenuTemplate(makeDeps({ platform: 'darwin' }));
    const appMenu = template[0].submenu as MenuItemConstructorOptions[];
    expect(appMenu.map((item) => item.role ?? item.type)).toContain('about');
    expect(appMenu[appMenu.length - 1]).toEqual({ role: 'quit' });
  });
});

describe('apps/chord buildApplicationMenuTemplate: File menu', () => {
  it('lists File items with the documented labels, accelerators, and command ids', () => {
    const emit = vi.fn();
    const template = buildApplicationMenuTemplate(makeDeps({ platform: 'darwin', emit }));
    const file = findMenu(template, 'File');

    const byLabel = Object.fromEntries(file.map((item) => [item.label, item]));
    expect(byLabel['New'].accelerator).toBe('CmdOrCtrl+N');
    expect(byLabel['Open…'].accelerator).toBe('CmdOrCtrl+O');
    expect(byLabel['Save'].accelerator).toBe('CmdOrCtrl+S');
    expect(byLabel['Save As…'].accelerator).toBe('Shift+CmdOrCtrl+S');
    expect(byLabel['Export…'].accelerator).toBe('CmdOrCtrl+E');
    expect(byLabel['Import Audio…']).toBeDefined();
    expect(byLabel['Import Lyrics…']).toBeDefined();
    expect(byLabel['Import Background…']).toBeDefined();
    expect(byLabel['Export Lyrics…']).toBeDefined();
    expect(byLabel['Open Recent']).toBeDefined();

    const commandFor: Record<string, MenuCommand> = {
      New: 'new',
      'Open…': 'open',
      Save: 'save',
      'Save As…': 'save-as',
      'Import Audio…': 'import-audio',
      'Import Lyrics…': 'import-cues',
      'Import Background…': 'import-background',
      'Export…': 'export',
      'Export Lyrics…': 'export-cues',
    };
    for (const [label, command] of Object.entries(commandFor)) {
      click(byLabel[label]);
      expect(emit).toHaveBeenCalledWith(command);
    }
  });

  it('puts Quit at the bottom of File on non-darwin, and not on darwin', () => {
    const darwinFile = findMenu(buildApplicationMenuTemplate(makeDeps({ platform: 'darwin' })), 'File');
    expect(darwinFile.some((item) => item.role === 'quit')).toBe(false);

    const win32File = findMenu(buildApplicationMenuTemplate(makeDeps({ platform: 'win32' })), 'File');
    expect(win32File[win32File.length - 1]).toEqual({ role: 'quit' });
  });

  it('shows a disabled placeholder when there are no recent projects', () => {
    const template = buildApplicationMenuTemplate(makeDeps({ recentProjects: [] }));
    const file = findMenu(template, 'File');
    const recent = file.find((item) => item.label === 'Open Recent');
    const submenu = recent?.submenu as MenuItemConstructorOptions[];

    expect(submenu).toEqual([{ label: 'No Recent Projects', enabled: false }]);
  });

  it('lists recent projects and opens the clicked one by path', () => {
    const onOpenRecent = vi.fn();
    const recentProjects: RecentProject[] = [
      { path: '/tmp/a.lumachord', title: 'Song A', openedAt: '2026-01-01T00:00:00.000Z' },
      { path: '/tmp/b.lumachord', title: '', openedAt: '2026-01-02T00:00:00.000Z' },
    ];
    const template = buildApplicationMenuTemplate(makeDeps({ recentProjects, onOpenRecent }));
    const file = findMenu(template, 'File');
    const recent = file.find((item) => item.label === 'Open Recent');
    const submenu = recent?.submenu as MenuItemConstructorOptions[];

    expect(submenu.map((item) => item.label)).toEqual(['Song A', 'b.lumachord']);

    click(submenu[0]);
    expect(onOpenRecent).toHaveBeenCalledWith('/tmp/a.lumachord');
    click(submenu[1]);
    expect(onOpenRecent).toHaveBeenCalledWith('/tmp/b.lumachord');
  });
});

describe('apps/chord buildApplicationMenuTemplate: Edit menu', () => {
  it('sends undo/redo/delete as commands and keeps native roles for the rest', () => {
    const emit = vi.fn();
    const template = buildApplicationMenuTemplate(makeDeps({ emit }));
    const edit = findMenu(template, 'Edit');

    const roles = edit.map((item) => item.role).filter((role): role is NonNullable<typeof role> => role !== undefined);
    expect(roles).toEqual(['cut', 'copy', 'paste', 'selectAll']);

    const byLabel = Object.fromEntries(edit.map((item) => [item.label, item]));
    expect(byLabel['Undo'].accelerator).toBe('CmdOrCtrl+Z');
    expect(byLabel['Redo'].accelerator).toBe('Shift+CmdOrCtrl+Z');
    expect(byLabel['Delete'].accelerator).toBe('Delete');

    click(byLabel['Undo']);
    click(byLabel['Redo']);
    click(byLabel['Delete']);
    expect(emit).toHaveBeenNthCalledWith(1, 'undo');
    expect(emit).toHaveBeenNthCalledWith(2, 'redo');
    expect(emit).toHaveBeenNthCalledWith(3, 'delete-selection');
  });
});

describe('apps/chord buildApplicationMenuTemplate: Timeline menu', () => {
  it('unregisters the bare-key accelerators so typing a lyric is not hijacked', () => {
    const emit = vi.fn();
    const template = buildApplicationMenuTemplate(makeDeps({ emit }));
    const timeline = findMenu(template, 'Timeline');
    const byLabel = Object.fromEntries(timeline.map((item) => [item.label, item]));

    expect(byLabel['Play/Pause'].accelerator).toBe('Space');
    expect(byLabel['Play/Pause'].registerAccelerator).toBe(false);
    expect(byLabel['Add Cue at Playhead'].accelerator).toBe('M');
    expect(byLabel['Add Cue at Playhead'].registerAccelerator).toBe(false);
    expect(byLabel['Split at Playhead'].accelerator).toBe('S');
    expect(byLabel['Split at Playhead'].registerAccelerator).toBe(false);

    click(byLabel['Play/Pause']);
    click(byLabel['Add Cue at Playhead']);
    click(byLabel['Split at Playhead']);
    expect(emit).toHaveBeenNthCalledWith(1, 'play-pause');
    expect(emit).toHaveBeenNthCalledWith(2, 'add-cue');
    expect(emit).toHaveBeenNthCalledWith(3, 'split-cue');
  });

  it('keeps modifier-based zoom accelerators registered', () => {
    const emit = vi.fn();
    const template = buildApplicationMenuTemplate(makeDeps({ emit }));
    const timeline = findMenu(template, 'Timeline');
    const byLabel = Object.fromEntries(timeline.map((item) => [item.label, item]));

    expect(byLabel['Zoom In'].accelerator).toBe('CmdOrCtrl+=');
    expect(byLabel['Zoom In'].registerAccelerator).toBeUndefined();
    expect(byLabel['Zoom Out'].accelerator).toBe('CmdOrCtrl+-');
    expect(byLabel['Zoom to Fit'].accelerator).toBe('CmdOrCtrl+0');

    click(byLabel['Zoom In']);
    click(byLabel['Zoom Out']);
    click(byLabel['Zoom to Fit']);
    expect(emit).toHaveBeenNthCalledWith(1, 'zoom-in');
    expect(emit).toHaveBeenNthCalledWith(2, 'zoom-out');
    expect(emit).toHaveBeenNthCalledWith(3, 'zoom-fit');
  });
});

describe('apps/chord buildApplicationMenuTemplate: View menu', () => {
  it('shows reload/devtools only when unpackaged', () => {
    const packaged = findMenu(buildApplicationMenuTemplate(makeDeps({ isPackaged: true })), 'View');
    expect(packaged.map((item) => item.role)).toEqual(['togglefullscreen']);

    const unpackaged = findMenu(buildApplicationMenuTemplate(makeDeps({ isPackaged: false })), 'View');
    expect(unpackaged.map((item) => item.role ?? item.type)).toEqual([
      'reload',
      'forceReload',
      'toggleDevTools',
      'separator',
      'togglefullscreen',
    ]);
  });
});

describe('apps/chord buildApplicationMenuTemplate: Window menu', () => {
  it('differs by platform', () => {
    const darwin = findMenu(buildApplicationMenuTemplate(makeDeps({ platform: 'darwin' })), 'Window');
    expect(darwin.map((item) => item.role ?? item.type)).toEqual(['minimize', 'zoom', 'separator', 'front', 'window']);

    const win32 = findMenu(buildApplicationMenuTemplate(makeDeps({ platform: 'win32' })), 'Window');
    expect(win32.map((item) => item.role)).toEqual(['minimize', 'close']);
  });
});

describe('apps/chord buildApplicationMenuTemplate: Help menu', () => {
  it('opens release notes through the injected callback', () => {
    const onOpenReleaseNotes = vi.fn();
    const template = buildApplicationMenuTemplate(makeDeps({ onOpenReleaseNotes }));
    const help = template.find((item) => item.role === 'help');
    const submenu = help?.submenu as MenuItemConstructorOptions[];

    click(submenu.find((item) => item.label === 'Release Notes'));
    expect(onOpenReleaseNotes).toHaveBeenCalledOnce();
  });

  it('adds an About item on non-darwin only', () => {
    const darwinHelp = findMenu(buildApplicationMenuTemplate(makeDeps({ platform: 'darwin' })), 'Help');
    expect(darwinHelp.some((item) => item.label?.startsWith('About'))).toBe(false);

    const win32Help = findMenu(buildApplicationMenuTemplate(makeDeps({ platform: 'win32' })), 'Help');
    expect(win32Help.some((item) => item.label === 'About LumaChord')).toBe(true);
  });

  it('points RELEASES_URL at the LumaCast releases page', () => {
    expect(RELEASES_URL).toBe('https://github.com/IT-PSAPE/LumaCast/releases');
  });
});

describe('apps/chord installApplicationMenu / rebuildRecentMenu', () => {
  it('installs a native menu built from the template', () => {
    installApplicationMenu(makeDeps({ platform: 'darwin' }));
    expect(Menu.setApplicationMenu).toHaveBeenCalled();
    expect(Menu.buildFromTemplate).toHaveBeenCalled();
  });

  it('rebuildRecentMenu replaces just the recent-projects list and reinstalls the menu', () => {
    vi.mocked(Menu.setApplicationMenu).mockClear();
    installApplicationMenu(makeDeps({ platform: 'darwin', recentProjects: [] }));
    vi.mocked(Menu.setApplicationMenu).mockClear();

    const recent: RecentProject[] = [{ path: '/tmp/a.lumachord', title: 'A', openedAt: '2026-01-01T00:00:00.000Z' }];
    rebuildRecentMenu(recent);

    expect(Menu.setApplicationMenu).toHaveBeenCalledOnce();
    const lastCallTemplate = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)?.[0] as MenuItemConstructorOptions[];
    const file = findMenu(lastCallTemplate, 'File');
    const openRecent = file.find((item) => item.label === 'Open Recent');
    expect((openRecent?.submenu as MenuItemConstructorOptions[]).map((item) => item.label)).toEqual(['A']);
  });
});

describe('apps/chord buildApplicationMenuTemplate: full item flattening sanity', () => {
  it('every clickable item has either a role or a click handler', () => {
    const template = buildApplicationMenuTemplate(makeDeps({ platform: 'darwin', recentProjects: [
      { path: '/tmp/a.lumachord', title: 'A', openedAt: '2026-01-01T00:00:00.000Z' },
    ] }));
    for (const item of flatten(template)) {
      if (item.type === 'separator') continue;
      if (item.submenu) continue;
      expect(item.role !== undefined || typeof item.click === 'function').toBe(true);
    }
  });
});
