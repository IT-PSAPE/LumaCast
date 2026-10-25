// Lumaflux's native menu. `buildApplicationMenuTemplate` is a pure function of
// `ApplicationMenuDeps`, so labels, accelerators and command mapping are
// testable without a real Menu; `installApplicationMenu` is the thin binding.
// Installing our own menu replaces Electron's default one, which would ship
// Reload and Toggle DevTools in production (Cmd+R blanks the app).
import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { APP_IDENTITY } from './app-identity';
import type { AppCommand, RatingCommand } from '../shared/app-command';

export interface ApplicationMenuDeps {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  /** Pushes an AppCommand to the renderer over MENU_COMMAND_CHANNEL. */
  emit: (command: AppCommand) => void;
}

// Bare keys carry no modifier, so Electron would register them app-wide and
// swallow them while typing in the search field. `registerAccelerator: false`
// keeps the hint in the menu; the renderer's own keydown handling (which skips
// text fields) is what actually fires them.
function bareKey(
  deps: ApplicationMenuDeps,
  label: string,
  accelerator: string,
  command: AppCommand,
): MenuItemConstructorOptions {
  return { label, accelerator, registerAccelerator: false, click: () => deps.emit(command) };
}

function buildFileMenu(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    { label: 'Import Photos…', accelerator: 'CmdOrCtrl+I', click: () => deps.emit('import-photos') },
    { label: 'Import Folder…', accelerator: 'Shift+CmdOrCtrl+I', click: () => deps.emit('import-folder') },
    { type: 'separator' },
    { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: () => deps.emit('export') },
  ];
  // macOS has Quit in the app menu; other platforms get it at the end of File.
  if (deps.platform !== 'darwin') items.push({ type: 'separator' }, { role: 'quit' });
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
  ];
}

function buildPhotoMenu(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  const ratings: MenuItemConstructorOptions[] = [1, 2, 3, 4, 5].map((n) =>
    bareKey(deps, `${n} ${n === 1 ? 'Star' : 'Stars'}`, String(n), `rate-${n}` as RatingCommand),
  );
  return [
    bareKey(deps, 'Toggle Favorite', 'F', 'favorite'),
    { type: 'separator' },
    ...ratings,
    bareKey(deps, 'Clear Rating', '0', 'rate-0'),
  ];
}

function buildViewMenu(deps: ApplicationMenuDeps): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    bareKey(deps, 'Library', 'G', 'library'),
    bareKey(deps, 'Edit', 'E', 'edit'),
    bareKey(deps, 'Toggle Clipping Warnings', 'J', 'toggle-clipping'),
    { type: 'separator' },
  ];
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
    { label: 'Photo', submenu: buildPhotoMenu(deps) },
    { label: 'View', submenu: buildViewMenu(deps) },
    { label: 'Window', submenu: buildWindowMenu(deps) },
  );
  // Non-macOS has no app menu, so About lives in a Help menu there.
  if (deps.platform !== 'darwin') {
    template.push({
      role: 'help',
      label: 'Help',
      submenu: [{ label: `About ${APP_IDENTITY.name}`, click: () => app.showAboutPanel() }],
    });
  }
  return template;
}

export function installApplicationMenu(deps: ApplicationMenuDeps): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate(deps)));
}
