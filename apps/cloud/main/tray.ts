import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { buildCloudTrayMenu, type CloudTrayMenuOptions } from './tray-menu';

export type CloudTrayOptions = CloudTrayMenuOptions;

function trayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icon.png')
    : path.join(app.getAppPath(), 'resources', 'tray-icon.png');
}

function templateIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tray-iconTemplate.png')
    : path.join(app.getAppPath(), 'resources', 'tray-iconTemplate.png');
}

export function createCloudTray(options: CloudTrayOptions): Tray {
  const icon = nativeImage.createFromPath(process.platform === 'darwin' ? templateIconPath() : trayIconPath());
  if (process.platform === 'darwin') icon.setTemplateImage(true);

  const tray = new Tray(icon);
  tray.setToolTip('LumaCloud');
  tray.setContextMenu(Menu.buildFromTemplate(buildCloudTrayMenu(options)));
  tray.on('click', options.onOpen);
  return tray;
}
