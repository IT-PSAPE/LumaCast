import type { MenuItemConstructorOptions } from 'electron';

export interface CloudTrayMenuOptions {
  onOpen: () => void;
  onCheckForUpdates: () => void;
  onQuit: () => void;
}

export function buildCloudTrayMenu(options: CloudTrayMenuOptions): MenuItemConstructorOptions[] {
  return [
    { label: 'Open LumaCloud', click: options.onOpen },
    { label: 'Check for Updates…', click: options.onCheckForUpdates },
    { type: 'separator' },
    { label: 'Quit LumaCloud', click: options.onQuit },
  ];
}
