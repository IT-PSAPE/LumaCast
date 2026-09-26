// LumaCloud's application menu. Unlike apps/cast/main/application-menu.ts,
// there is no per-window command state to rebuild against — the suite
// manager's actions (refresh, check for updates) are always available, so
// this is a static template built once at startup.
import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';

export interface InstallApplicationMenuOptions {
  onCheckForUpdates: () => void;
  onRefresh: () => void;
}

const RELEASES_URL = 'https://github.com/IT-PSAPE/LumaCast/releases';

function buildFileMenu(options: InstallApplicationMenuOptions): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [
    {
      label: 'Refresh Catalog',
      accelerator: 'CmdOrCtrl+R',
      click: () => options.onRefresh(),
    },
  ];

  // macOS gets Check for Updates and Quit in the app menu; every other
  // platform has no app menu, so both live here instead.
  if (process.platform !== 'darwin') {
    items.push(
      { type: 'separator' },
      { label: 'Check for Updates…', click: () => options.onCheckForUpdates() },
      { type: 'separator' },
      { role: 'quit' },
    );
  }

  return items;
}

function buildEditMenu(): MenuItemConstructorOptions[] {
  return [
    { role: 'undo' },
    { role: 'redo' },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'selectAll' },
  ];
}

function buildViewMenu(): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = [];

  if (!app.isPackaged) {
    items.push({ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' });
  }

  items.push(
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  );

  return items;
}

function buildWindowMenu(): MenuItemConstructorOptions[] {
  return process.platform === 'darwin'
    ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }, { role: 'window' }]
    : [{ role: 'minimize' }, { role: 'close' }];
}

function buildHelpMenu(): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Release Notes',
      click: () => {
        void shell.openExternal(RELEASES_URL);
      },
    },
  ];
}

export function installApplicationMenu(options: InstallApplicationMenuOptions): void {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Check for Updates…', click: () => options.onCheckForUpdates() },
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
    { label: 'File', submenu: buildFileMenu(options) },
    { label: 'Edit', submenu: buildEditMenu() },
    { label: 'View', submenu: buildViewMenu() },
    { label: 'Window', submenu: buildWindowMenu() },
    { role: 'help', label: 'Help', submenu: buildHelpMenu() },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
