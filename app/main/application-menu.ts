import { app, BrowserWindow, Menu, type MenuItemConstructorOptions, shell } from 'electron';
import { APP_MENU_EVENTS, type InlineWindowMenuBounds } from '@core/ipc';
import type { AppMenuCommandId, AppMenuState } from '@lumacast/commands';

export interface InlineWindowMenuItem {
  id: string;
  label: string;
}

export interface SerializableMenuItem {
  id?: string;
  commandId?: AppMenuCommandId;
  label?: string;
  accelerator?: string;
  enabled?: boolean;
  visible?: boolean;
  checked?: boolean;
  role?: MenuItemConstructorOptions['role'];
  type?: MenuItemConstructorOptions['type'];
  submenu?: SerializableMenuItem[];
}

export interface ApplicationMenuDescriptor {
  webContentsId: number | null;
  items: SerializableMenuItem[];
}

export interface ApplicationMenuDiagnostics {
  requestedRebuilds: number;
  actualRebuilds: number;
}

const DEFAULT_APP_MENU_STATE: AppMenuState = {
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
};

let currentAppMenuState: AppMenuState = DEFAULT_APP_MENU_STATE;
let installedDescriptor: ApplicationMenuDescriptor | null = null;
let requestedRebuildCount = 0;
let actualRebuildCount = 0;

function isDevelopment(): boolean {
  return !app.isPackaged;
}

function sendMenuCommand(browserWindow: BrowserWindow | null, commandId: AppMenuCommandId) {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  browserWindow.webContents.send(APP_MENU_EVENTS.command, commandId);
}

function commandDescriptor(
  commandId: AppMenuCommandId,
  options: Omit<SerializableMenuItem, 'commandId'>,
): SerializableMenuItem {
  return { commandId, ...options };
}

function buildFileMenu(state: AppMenuState): SerializableMenuItem[] {
  return [
    commandDescriptor('file.newPresentation', {
      label: 'New Presentation',
      accelerator: 'CmdOrCtrl+N',
    }),
    commandDescriptor('file.newLyric', {
      label: 'New Lyric',
    }),
    { type: 'separator' },
    commandDescriptor('file.newLibrary', {
      label: 'New Library',
    }),
    commandDescriptor('file.newPlaylist', {
      label: 'New Playlist',
      enabled: state.hasCurrentLibrary,
    }),
    commandDescriptor('file.newGroup', {
      label: 'New Group',
      enabled: state.hasCurrentPlaylist,
    }),
    commandDescriptor('file.newSlide', {
      label: 'New Slide',
      accelerator: 'CmdOrCtrl+Shift+N',
      enabled: state.hasCurrentDeckItem,
    }),
    { type: 'separator' },
    commandDescriptor('file.exportCurrentItem', {
      label: 'Export Current Item…',
      enabled: state.hasCurrentDeckItem,
    }),
    commandDescriptor('file.exportWorkspace', {
      label: 'Export Workspace…',
      enabled: state.canExportWorkspace,
    }),
    { type: 'separator' },
    commandDescriptor('app.openSettings', {
      label: 'Settings',
      accelerator: 'CmdOrCtrl+,',
    }),
    commandDescriptor('app.checkForUpdates', {
      label: 'Check for Updates…',
    }),
    { type: 'separator' },
    process.platform === 'darwin'
      ? { role: 'close' }
      : { role: 'quit' },
  ];
}

function buildEditMenu(state: AppMenuState): SerializableMenuItem[] {
  return [
    commandDescriptor('edit.undo', {
      label: 'Undo',
      accelerator: process.platform === 'darwin' ? 'Cmd+Z' : 'Ctrl+Z',
      enabled: state.canUndo,
    }),
    commandDescriptor('edit.redo', {
      label: 'Redo',
      accelerator: process.platform === 'darwin' ? 'Cmd+Shift+Z' : 'Ctrl+Shift+Z',
      enabled: state.canRedo,
    }),
    { type: 'separator' },
    commandDescriptor('edit.cut', {
      label: 'Cut',
      accelerator: 'CmdOrCtrl+X',
      enabled: state.canCut,
    }),
    commandDescriptor('edit.copy', {
      label: 'Copy',
      accelerator: 'CmdOrCtrl+C',
      enabled: state.canCopy,
    }),
    commandDescriptor('edit.paste', {
      label: 'Paste',
      accelerator: 'CmdOrCtrl+V',
      enabled: state.canPaste,
    }),
    commandDescriptor('edit.duplicate', {
      label: 'Duplicate',
      accelerator: 'CmdOrCtrl+D',
      enabled: state.canDuplicate,
    }),
    commandDescriptor('edit.delete', {
      label: 'Delete',
      accelerator: 'Delete',
      enabled: state.canDelete,
    }),
    commandDescriptor('edit.clearSelection', {
      label: 'Select None',
      accelerator: 'Escape',
      enabled: state.canClearSelection,
    }),
    { type: 'separator' },
    { role: 'selectAll' },
    { type: 'separator' },
    commandDescriptor('view.openCommandPalette', {
      label: 'Command Palette…',
      accelerator: 'CmdOrCtrl+K',
    }),
  ];
}

function buildViewMenu(state: AppMenuState): SerializableMenuItem[] {
  return [
    commandDescriptor('view.mode.show', {
      label: 'Show',
      type: 'radio',
      checked: state.workbenchMode === 'show',
    }),
    commandDescriptor('view.mode.deckEditor', {
      label: 'Slides',
      type: 'radio',
      checked: state.workbenchMode === 'deck-editor',
    }),
    commandDescriptor('view.mode.overlayEditor', {
      label: 'Overlays',
      type: 'radio',
      checked: state.workbenchMode === 'overlay-editor',
    }),
    commandDescriptor('view.mode.themeEditor', {
      label: 'Themes',
      type: 'radio',
      checked: state.workbenchMode === 'theme-editor',
    }),
    commandDescriptor('view.mode.stageEditor', {
      label: 'Stage',
      type: 'radio',
      checked: state.workbenchMode === 'stage-editor',
    }),
    commandDescriptor('view.mode.macroEditor', {
      label: 'Macros',
      type: 'radio',
      checked: state.workbenchMode === 'macro-editor',
    }),
    commandDescriptor('view.mode.settings', {
      label: 'Settings',
      type: 'radio',
      checked: state.workbenchMode === 'settings',
    }),
    { type: 'separator' },
    {
      label: 'Slide Browser Layout',
      submenu: [
        commandDescriptor('view.slideBrowser.grid', {
          label: 'Grid',
          type: 'radio',
          checked: state.slideBrowserMode === 'grid',
        }),
        commandDescriptor('view.slideBrowser.list', {
          label: 'List',
          type: 'radio',
          checked: state.slideBrowserMode === 'list',
        }),
      ],
    },
    {
      label: 'Playlist Layout',
      submenu: [
        commandDescriptor('view.playlistBrowser.current', {
          label: 'Current',
          type: 'radio',
          checked: state.playlistBrowserMode === 'current',
        }),
        commandDescriptor('view.playlistBrowser.tabs', {
          label: 'Tabs',
          type: 'radio',
          checked: state.playlistBrowserMode === 'tabs',
        }),
        commandDescriptor('view.playlistBrowser.continuous', {
          label: 'Continuous',
          type: 'radio',
          checked: state.playlistBrowserMode === 'continuous',
        }),
      ],
    },
    { type: 'separator' },
    { role: 'reload' },
    { role: 'forceReload' },
    { role: 'toggleDevTools' },
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ];
}

function buildPlaybackMenu(state: AppMenuState): SerializableMenuItem[] {
  return [
    commandDescriptor('playback.takeSlide', {
      label: 'Take Slide',
      accelerator: 'Enter',
      enabled: state.canTakeSlide,
    }),
    commandDescriptor('playback.previousSlide', {
      label: 'Previous Slide',
      accelerator: 'Left',
      enabled: state.canGoToPreviousSlide,
    }),
    commandDescriptor('playback.nextSlide', {
      label: 'Next Slide',
      accelerator: 'Right',
      enabled: state.canGoToNextSlide,
    }),
    { type: 'separator' },
    commandDescriptor('playback.toggleAudienceOutput', {
      label: 'Audience Output',
      type: 'checkbox',
      checked: state.audienceOutputEnabled,
    }),
    commandDescriptor('playback.toggleStageOutput', {
      label: 'Stage Output',
      type: 'checkbox',
      checked: state.stageOutputEnabled,
    }),
  ];
}

function buildWindowMenu(): SerializableMenuItem[] {
  return process.platform === 'darwin'
    ? [
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' },
      { role: 'window' },
    ]
    : [
      { role: 'minimize' },
      { role: 'close' },
    ];
}

function buildHelpMenu(): SerializableMenuItem[] {
  return [
    { id: 'help.checkForUpdates', label: 'Check for Updates…' },
    { type: 'separator' },
    { id: 'learn-more', label: 'LumaCast Website' },
  ];
}

function buildMenuItems(state: AppMenuState): SerializableMenuItem[] {
  const items: SerializableMenuItem[] = [];

  if (process.platform === 'darwin') {
    items.push({ role: 'appMenu' });
  }

  items.push(
    {
      id: 'file',
      label: 'File',
      submenu: buildFileMenu(state),
    },
    {
      id: 'edit',
      label: 'Edit',
      submenu: buildEditMenu(state),
    },
    {
      id: 'view',
      label: 'View',
      submenu: buildViewMenu(state),
    },
    {
      id: 'playback',
      label: 'Playback',
      submenu: buildPlaybackMenu(state),
    },
    {
      id: 'window',
      label: 'Window',
      submenu: buildWindowMenu(),
    },
    {
      id: 'help',
      role: 'help',
      label: 'Help',
      submenu: buildHelpMenu(),
    },
  );

  return items;
}

function getWebContentsId(browserWindow: BrowserWindow | null): number | null {
  if (!browserWindow || browserWindow.isDestroyed()) return null;
  return browserWindow.webContents.id;
}

function buildApplicationMenuDescriptor(
  browserWindow: BrowserWindow | null,
  state: AppMenuState,
): ApplicationMenuDescriptor {
  return {
    webContentsId: getWebContentsId(browserWindow),
    items: buildMenuItems(state),
  };
}

export function applicationMenuDescriptorsEqual(
  a: ApplicationMenuDescriptor,
  b: ApplicationMenuDescriptor,
): boolean {
  if (a.webContentsId !== b.webContentsId) return false;
  return menuItemsArrayEqual(a.items, b.items);
}

function menuItemsArrayEqual(a: SerializableMenuItem[], b: SerializableMenuItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!menuItemEqual(a[i], b[i])) return false;
  }
  return true;
}

function menuItemEqual(a: SerializableMenuItem, b: SerializableMenuItem): boolean {
  if (a.id !== b.id) return false;
  if (a.commandId !== b.commandId) return false;
  if (a.label !== b.label) return false;
  if (a.accelerator !== b.accelerator) return false;
  if (a.enabled !== b.enabled) return false;
  if (a.visible !== b.visible) return false;
  if (a.checked !== b.checked) return false;
  if (a.role !== b.role) return false;
  if (a.type !== b.type) return false;
  return menuItemsArrayEqual(a.submenu ?? [], b.submenu ?? []);
}

function toMenuTemplateItem(item: SerializableMenuItem, browserWindow: BrowserWindow | null): MenuItemConstructorOptions {
  const base: MenuItemConstructorOptions = {
    ...(item.id !== undefined ? { id: item.id } : {}),
    ...(item.label !== undefined ? { label: item.label } : {}),
    ...(item.accelerator !== undefined ? { accelerator: item.accelerator } : {}),
    ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
    ...(item.visible !== undefined ? { visible: item.visible } : {}),
    ...(item.checked !== undefined ? { checked: item.checked } : {}),
    ...(item.role !== undefined ? { role: item.role } : {}),
    ...(item.type !== undefined ? { type: item.type } : {}),
  };

  if (item.commandId) {
    return { ...base, click: () => { sendMenuCommand(browserWindow, item.commandId!); } };
  }

  if (item.id === 'help.checkForUpdates') {
    return {
      ...base,
      click: () => {
        sendMenuCommand(BrowserWindow.getFocusedWindow(), 'app.checkForUpdates');
      },
    };
  }

  if (item.id === 'learn-more') {
    return { ...base, click: () => { void shell.openExternal('https://openai.com'); } };
  }

  if (item.submenu) {
    return { ...base, submenu: item.submenu.map((child) => toMenuTemplateItem(child, browserWindow)) };
  }

  return base;
}

function toMenuTemplate(items: SerializableMenuItem[], browserWindow: BrowserWindow | null): MenuItemConstructorOptions[] {
  return items.map((item) => toMenuTemplateItem(item, browserWindow));
}

function buildMenuFromDescriptor(browserWindow: BrowserWindow | null, descriptor: ApplicationMenuDescriptor) {
  return Menu.buildFromTemplate(toMenuTemplate(descriptor.items, browserWindow));
}

function logMenuRebuild(descriptor: ApplicationMenuDescriptor): void {
  console.debug('[application-menu] rebuilt native menu', {
    webContentsId: descriptor.webContentsId,
    topLevelItems: descriptor.items.map((item) => item.label ?? item.role ?? item.type ?? '(unnamed)'),
    requestedRebuilds: requestedRebuildCount,
    actualRebuilds: actualRebuildCount,
  });
}

export function createApplicationMenu(
  browserWindow: BrowserWindow | null = null,
  state: AppMenuState = currentAppMenuState,
) {
  return buildMenuFromDescriptor(browserWindow, buildApplicationMenuDescriptor(browserWindow, state));
}

export function updateApplicationMenu(browserWindow: BrowserWindow | null, state: AppMenuState): void {
  currentAppMenuState = state;
  const nextDescriptor = buildApplicationMenuDescriptor(browserWindow, state);

  if (isDevelopment()) {
    requestedRebuildCount += 1;
  }

  if (installedDescriptor && applicationMenuDescriptorsEqual(installedDescriptor, nextDescriptor)) {
    return;
  }

  Menu.setApplicationMenu(buildMenuFromDescriptor(browserWindow, nextDescriptor));
  installedDescriptor = nextDescriptor;

  if (isDevelopment()) {
    actualRebuildCount += 1;
    logMenuRebuild(nextDescriptor);
  }
}

export function getApplicationMenuDiagnostics(): ApplicationMenuDiagnostics {
  return {
    requestedRebuilds: requestedRebuildCount,
    actualRebuilds: actualRebuildCount,
  };
}

export function resetApplicationMenuState(): void {
  installedDescriptor = null;
  requestedRebuildCount = 0;
  actualRebuildCount = 0;
}

export function getInlineWindowMenuItems(): InlineWindowMenuItem[] {
  const menu = Menu.getApplicationMenu();
  if (!menu) return [];

  return menu.items
    .filter((item) => item.id && item.label && item.submenu)
    .map((item) => ({ id: item.id, label: item.label }));
}

export function popupInlineWindowMenu(
  menuId: string,
  browserWindow: BrowserWindow,
  bounds: InlineWindowMenuBounds,
): Promise<void> {
  const menu = Menu.getApplicationMenu();
  const submenu = menu?.items.find((item) => item.id === menuId)?.submenu;
  if (!submenu) return Promise.resolve();

  return new Promise((resolve) => {
    submenu.popup({
      window: browserWindow,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      callback: () => { resolve(); },
    });
  });
}