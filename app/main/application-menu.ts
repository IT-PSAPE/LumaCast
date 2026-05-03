import { BrowserWindow, Menu, type MenuItemConstructorOptions, shell } from 'electron';
import { APP_MENU_EVENTS, type AppMenuCommandId, type AppMenuState, type InlineWindowMenuBounds } from '@core/ipc';

export interface InlineWindowMenuItem {
  id: string;
  label: string;
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

function sendMenuCommand(browserWindow: BrowserWindow | null, commandId: AppMenuCommandId) {
  if (!browserWindow || browserWindow.isDestroyed()) return;
  browserWindow.webContents.send(APP_MENU_EVENTS.command, commandId);
}

function createCommandItem(
  browserWindow: BrowserWindow | null,
  commandId: AppMenuCommandId,
  options: Omit<MenuItemConstructorOptions, 'click'>,
): MenuItemConstructorOptions {
  return {
    ...options,
    click: () => { sendMenuCommand(browserWindow, commandId); },
  };
}

function buildFileMenu(browserWindow: BrowserWindow | null, state: AppMenuState): MenuItemConstructorOptions[] {
  return [
    createCommandItem(browserWindow, 'file.newPresentation', {
      label: 'New Presentation',
      accelerator: 'CmdOrCtrl+N',
    }),
    createCommandItem(browserWindow, 'file.newLyric', {
      label: 'New Lyric',
    }),
    { type: 'separator' },
    createCommandItem(browserWindow, 'file.newLibrary', {
      label: 'New Library',
    }),
    createCommandItem(browserWindow, 'file.newPlaylist', {
      label: 'New Playlist',
      enabled: state.hasCurrentLibrary,
    }),
    createCommandItem(browserWindow, 'file.newSegment', {
      label: 'New Segment',
      enabled: state.hasCurrentPlaylist,
    }),
    createCommandItem(browserWindow, 'file.newSlide', {
      label: 'New Slide',
      accelerator: 'CmdOrCtrl+Shift+N',
      enabled: state.hasCurrentDeckItem,
    }),
    { type: 'separator' },
    createCommandItem(browserWindow, 'file.exportCurrentItem', {
      label: 'Export Current Item…',
      enabled: state.hasCurrentDeckItem,
    }),
    createCommandItem(browserWindow, 'file.exportWorkspace', {
      label: 'Export Workspace…',
      enabled: state.canExportWorkspace,
    }),
    { type: 'separator' },
    createCommandItem(browserWindow, 'app.openSettings', {
      label: 'Settings',
      accelerator: 'CmdOrCtrl+,',
    }),
    createCommandItem(browserWindow, 'app.checkForUpdates', {
      label: 'Check for Updates…',
    }),
    { type: 'separator' },
    process.platform === 'darwin'
      ? { role: 'close' }
      : { role: 'quit' },
  ];
}

function buildEditMenu(browserWindow: BrowserWindow | null, state: AppMenuState): MenuItemConstructorOptions[] {
  return [
    createCommandItem(browserWindow, 'edit.undo', {
      label: 'Undo',
      accelerator: process.platform === 'darwin' ? 'Cmd+Z' : 'Ctrl+Z',
      enabled: state.canUndo,
    }),
    createCommandItem(browserWindow, 'edit.redo', {
      label: 'Redo',
      accelerator: process.platform === 'darwin' ? 'Cmd+Shift+Z' : 'Ctrl+Shift+Z',
      enabled: state.canRedo,
    }),
    { type: 'separator' },
    createCommandItem(browserWindow, 'edit.cut', {
      label: 'Cut',
      accelerator: 'CmdOrCtrl+X',
      enabled: state.canCut,
    }),
    createCommandItem(browserWindow, 'edit.copy', {
      label: 'Copy',
      accelerator: 'CmdOrCtrl+C',
      enabled: state.canCopy,
    }),
    createCommandItem(browserWindow, 'edit.paste', {
      label: 'Paste',
      accelerator: 'CmdOrCtrl+V',
      enabled: state.canPaste,
    }),
    createCommandItem(browserWindow, 'edit.duplicate', {
      label: 'Duplicate',
      accelerator: 'CmdOrCtrl+D',
      enabled: state.canDuplicate,
    }),
    createCommandItem(browserWindow, 'edit.delete', {
      label: 'Delete',
      accelerator: 'Delete',
      enabled: state.canDelete,
    }),
    createCommandItem(browserWindow, 'edit.clearSelection', {
      label: 'Select None',
      accelerator: 'Escape',
      enabled: state.canClearSelection,
    }),
    { type: 'separator' },
    { role: 'selectAll' },
    { type: 'separator' },
    createCommandItem(browserWindow, 'view.openCommandPalette', {
      label: 'Command Palette…',
      accelerator: 'CmdOrCtrl+K',
    }),
  ];
}

function buildViewMenu(browserWindow: BrowserWindow | null, state: AppMenuState): MenuItemConstructorOptions[] {
  return [
    createCommandItem(browserWindow, 'view.mode.show', {
      label: 'Show',
      type: 'radio',
      checked: state.workbenchMode === 'show',
    }),
    createCommandItem(browserWindow, 'view.mode.deckEditor', {
      label: 'Slides',
      type: 'radio',
      checked: state.workbenchMode === 'deck-editor',
    }),
    createCommandItem(browserWindow, 'view.mode.overlayEditor', {
      label: 'Overlays',
      type: 'radio',
      checked: state.workbenchMode === 'overlay-editor',
    }),
    createCommandItem(browserWindow, 'view.mode.themeEditor', {
      label: 'Themes',
      type: 'radio',
      checked: state.workbenchMode === 'theme-editor',
    }),
    createCommandItem(browserWindow, 'view.mode.stageEditor', {
      label: 'Stage',
      type: 'radio',
      checked: state.workbenchMode === 'stage-editor',
    }),
    createCommandItem(browserWindow, 'view.mode.settings', {
      label: 'Settings',
      type: 'radio',
      checked: state.workbenchMode === 'settings',
    }),
    { type: 'separator' },
    {
      label: 'Slide Browser Layout',
      submenu: [
        createCommandItem(browserWindow, 'view.slideBrowser.grid', {
          label: 'Grid',
          type: 'radio',
          checked: state.slideBrowserMode === 'grid',
        }),
        createCommandItem(browserWindow, 'view.slideBrowser.list', {
          label: 'List',
          type: 'radio',
          checked: state.slideBrowserMode === 'list',
        }),
      ],
    },
    {
      label: 'Playlist Layout',
      submenu: [
        createCommandItem(browserWindow, 'view.playlistBrowser.current', {
          label: 'Current',
          type: 'radio',
          checked: state.playlistBrowserMode === 'current',
        }),
        createCommandItem(browserWindow, 'view.playlistBrowser.tabs', {
          label: 'Tabs',
          type: 'radio',
          checked: state.playlistBrowserMode === 'tabs',
        }),
        createCommandItem(browserWindow, 'view.playlistBrowser.continuous', {
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

function buildPlaybackMenu(browserWindow: BrowserWindow | null, state: AppMenuState): MenuItemConstructorOptions[] {
  return [
    createCommandItem(browserWindow, 'playback.takeSlide', {
      label: 'Take Slide',
      accelerator: 'Enter',
      enabled: state.canTakeSlide,
    }),
    createCommandItem(browserWindow, 'playback.previousSlide', {
      label: 'Previous Slide',
      accelerator: 'Left',
      enabled: state.canGoToPreviousSlide,
    }),
    createCommandItem(browserWindow, 'playback.nextSlide', {
      label: 'Next Slide',
      accelerator: 'Right',
      enabled: state.canGoToNextSlide,
    }),
    { type: 'separator' },
    createCommandItem(browserWindow, 'playback.toggleAudienceOutput', {
      label: 'Audience Output',
      type: 'checkbox',
      checked: state.audienceOutputEnabled,
    }),
    createCommandItem(browserWindow, 'playback.toggleStageOutput', {
      label: 'Stage Output',
      type: 'checkbox',
      checked: state.stageOutputEnabled,
    }),
  ];
}

function buildWindowMenu(): MenuItemConstructorOptions[] {
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

function buildHelpMenu(): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Check for Updates…',
      click: () => {
        const browserWindow = BrowserWindow.getFocusedWindow();
        if (!browserWindow || browserWindow.isDestroyed()) return;
        browserWindow.webContents.send(APP_MENU_EVENTS.command, 'app.checkForUpdates');
      },
    },
    { type: 'separator' },
    {
      id: 'learn-more',
      label: 'LumaCast Website',
      click: () => {
        void shell.openExternal('https://openai.com');
      },
    },
  ];
}

export function createApplicationMenu(
  browserWindow: BrowserWindow | null = null,
  state: AppMenuState = currentAppMenuState,
) {
  const theme: MenuItemConstructorOptions[] = [];

  if (process.platform === 'darwin') {
    theme.push({ role: 'appMenu' });
  }

  theme.push(
    {
      id: 'file',
      label: 'File',
      submenu: buildFileMenu(browserWindow, state),
    },
    {
      id: 'edit',
      label: 'Edit',
      submenu: buildEditMenu(browserWindow, state),
    },
    {
      id: 'view',
      label: 'View',
      submenu: buildViewMenu(browserWindow, state),
    },
    {
      id: 'playback',
      label: 'Playback',
      submenu: buildPlaybackMenu(browserWindow, state),
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

  return Menu.buildFromTemplate(theme);
}

export function updateApplicationMenu(browserWindow: BrowserWindow | null, state: AppMenuState): void {
  currentAppMenuState = state;
  Menu.setApplicationMenu(createApplicationMenu(browserWindow, state));
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
