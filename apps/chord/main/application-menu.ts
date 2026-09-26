// LumaChord's native menu. `buildApplicationMenuTemplate` is a pure function
// of `ApplicationMenuDeps` (no Electron state read inside it beyond the
// constructor options) so its shape — labels, accelerators, which commands
// map to which items — is unit-testable without a real Menu;
// `installApplicationMenu`/`rebuildRecentMenu` are the thin binding to
// `Menu.setApplicationMenu`, mirroring apps/cloud/main/application-menu.ts.
import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import { APP_IDENTITY } from './app-identity';
import type { MenuCommand } from '../shared/desktop-api';
import type { RecentProject } from '../shared/project';

/** Also passed to `deps.onOpenReleaseNotes`'s implementation in main/index.ts,
 *  exported here so the URL is defined in exactly one place. */
export const RELEASES_URL = 'https://github.com/IT-PSAPE/LumaCast/releases';

export interface ApplicationMenuDeps {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  recentProjects: RecentProject[];
  /** Pushes a MenuCommand to the renderer over MENU_COMMAND_CHANNEL. */
  emit: (command: MenuCommand) => void;
  /** An Open Recent item was clicked; main reads/admits/pushes that project
   *  directly rather than round-tripping through a MenuCommand (which has no
   *  path payload) — see main/index.ts's handleOpenDocument. */
  onOpenRecent: (path: string) => void;
  onOpenReleaseNotes: () => void;
}

function buildRecentSubmenu(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  if (deps.recentProjects.length === 0) {
    return [{ label: 'No Recent Projects', enabled: false }];
  }
  return deps.recentProjects.map((entry) => ({
    label: entry.title || path.basename(entry.path),
    click: () => deps.onOpenRecent(entry.path),
  }));
}

function buildFileMenu(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => deps.emit('new') },
    { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => deps.emit('open') },
    { label: 'Open Recent', submenu: buildRecentSubmenu(deps) },
    { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => deps.emit('save') },
    { label: 'Save As…', accelerator: 'Shift+CmdOrCtrl+S', click: () => deps.emit('save-as') },
    { type: 'separator' },
    { label: 'Import Audio…', click: () => deps.emit('import-audio') },
    { label: 'Import Lyrics…', click: () => deps.emit('import-cues') },
    { label: 'Import Background…', click: () => deps.emit('import-background') },
    { type: 'separator' },
    { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: () => deps.emit('export') },
    { label: 'Export Lyrics…', click: () => deps.emit('export-cues') },
  ];

  // macOS gets Quit in the app menu; every other platform has no app menu, so
  // it lives at the bottom of File instead (matches apps/cloud's pattern).
  if (deps.platform !== 'darwin') {
    items.push({ type: 'separator' }, { role: 'quit' });
  }

  return items;
}

function buildEditMenu(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  return [
    { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => deps.emit('undo') },
    { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => deps.emit('redo') },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'selectAll' },
    { type: 'separator' },
    { label: 'Delete', accelerator: 'Delete', click: () => deps.emit('delete-selection') },
  ];
}

// Space/M/S carry no modifier: Electron would otherwise register them as
// app-wide accelerators, which fires on every keystroke while typing a lyric
// — `registerAccelerator: false` keeps the label/hint in the menu without
// stealing the key, and the renderer's own keydown handling (scoped to when
// the timeline, not a text field, has focus) is what actually triggers these.
function buildTimelineMenu(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  return [
    { label: 'Play/Pause', accelerator: 'Space', registerAccelerator: false, click: () => deps.emit('play-pause') },
    { label: 'Add Cue at Playhead', accelerator: 'M', registerAccelerator: false, click: () => deps.emit('add-cue') },
    { label: 'Split at Playhead', accelerator: 'S', registerAccelerator: false, click: () => deps.emit('split-cue') },
    { type: 'separator' },
    { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => deps.emit('zoom-in') },
    { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => deps.emit('zoom-out') },
    { label: 'Zoom to Fit', accelerator: 'CmdOrCtrl+0', click: () => deps.emit('zoom-fit') },
  ];
}

function buildViewMenu(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];

  if (!deps.isPackaged) {
    items.push({ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' });
  }

  items.push({ role: 'togglefullscreen' });
  return items;
}

function buildWindowMenu(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  return deps.platform === 'darwin'
    ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }, { role: 'window' }]
    : [{ role: 'minimize' }, { role: 'close' }];
}

function buildHelpMenu(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    { label: 'Release Notes', click: () => deps.onOpenReleaseNotes() },
  ];

  // macOS already has About in the app menu; every other platform has no app
  // menu, so About lives in Help instead (matches Windows/Linux convention).
  if (deps.platform !== 'darwin') {
    items.push({ type: 'separator' }, { label: `About ${APP_IDENTITY.name}`, click: () => app.showAboutPanel() });
  }

  return items;
}

export function buildApplicationMenuTemplate(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];

  if (deps.platform === 'darwin') {
    template.push({
      label: APP_IDENTITY.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push(
    { label: 'File', submenu: buildFileMenu(deps) },
    { label: 'Edit', submenu: buildEditMenu(deps) },
    { label: 'Timeline', submenu: buildTimelineMenu(deps) },
    { label: 'View', submenu: buildViewMenu(deps) },
    { label: 'Window', submenu: buildWindowMenu(deps) },
    { role: 'help', label: 'Help', submenu: buildHelpMenu(deps) },
  );

  return template;
}

let currentDeps: ApplicationMenuDeps | null = null;

export function installApplicationMenu(deps: ApplicationMenuDeps): void {
  currentDeps = deps;
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate(deps)));
}

/** Rebuilds just the Open Recent submenu contents (recent-projects list
 *  changed) by rebuilding the whole menu against the last-installed deps —
 *  the native Menu API has no way to patch one submenu in place. */
export function rebuildRecentMenu(recent: RecentProject[]): void {
  if (!currentDeps) return;
  currentDeps = { ...currentDeps, recentProjects: recent };
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate(currentDeps)));
}
