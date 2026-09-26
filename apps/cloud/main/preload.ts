// The one and only surface the renderer can reach. It is a fixed set of
// channels over `ipcRenderer.invoke`; the renderer never sees a module
// namespace or an `ipcRenderer` handle, and main independently validates that
// every invocation comes from this window's main frame (see main/ipc.ts).
//
// `window.lumacloud` is the global CloudDesktopAPI declares (apps/cloud/shared
// /desktop-api.ts); only the implementation behind it lives here.
import { contextBridge, ipcRenderer } from 'electron';
import type { CloudDesktopAPI } from '../shared/desktop-api';
import { IPC_CHANNELS, OPERATION_CHANGE_CHANNEL, OVERVIEW_CHANGE_CHANNEL } from './ipc-channels';

const api: CloudDesktopAPI = {
  overview: () => ipcRenderer.invoke(IPC_CHANNELS.overview),
  refresh: () => ipcRenderer.invoke(IPC_CHANNELS.refresh),
  releases: (app) => ipcRenderer.invoke(IPC_CHANNELS.releases, app),

  grant: (app) => ipcRenderer.invoke(IPC_CHANNELS.grant, app),
  revoke: (app) => ipcRenderer.invoke(IPC_CHANNELS.revoke, app),
  updateSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),

  install: (app, version) => ipcRenderer.invoke(IPC_CHANNELS.install, app, version),
  uninstall: (app, options) => ipcRenderer.invoke(IPC_CHANNELS.uninstall, app, options),
  cancel: (operationId) => ipcRenderer.invoke(IPC_CHANNELS.cancel, operationId),
  operations: () => ipcRenderer.invoke(IPC_CHANNELS.operations),

  open: (app) => ipcRenderer.invoke(IPC_CHANNELS.open, app),
  reveal: (app) => ipcRenderer.invoke(IPC_CHANNELS.reveal, app),
  openReleaseNotes: (app, version) => ipcRenderer.invoke(IPC_CHANNELS.openReleaseNotes, app, version),

  checkForSelfUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.checkForSelfUpdate),
  installSelfUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.installSelfUpdate),

  onOverview: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, overview: Parameters<typeof callback>[0]) =>
      callback(overview);
    ipcRenderer.on(OVERVIEW_CHANGE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(OVERVIEW_CHANGE_CHANNEL, handler);
  },
  onOperation: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, operation: Parameters<typeof callback>[0]) =>
      callback(operation);
    ipcRenderer.on(OPERATION_CHANGE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(OPERATION_CHANGE_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('lumacloud', api);
