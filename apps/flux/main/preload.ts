import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopAPI } from '../shared/desktop-api';
import { CATALOG_CHANGE_CHANNEL, IPC_CHANNELS } from './ipc-channels';

// The one and only surface the renderer can reach. It is a fixed set of
// channels over `ipcRenderer.invoke`; the renderer never sees a module
// namespace, a file path, or an `ipcRenderer` handle, and main independently
// validates that every invocation comes from this window's main frame.
//
// `window.lumaflux` keeps the name the Lumaflux UI already uses; only the
// implementation behind it is new.
const api: DesktopAPI = {
  command: (name, args) => ipcRenderer.invoke(IPC_CHANNELS.command, name, args),
  chooseImport: (folder) => ipcRenderer.invoke(IPC_CHANNELS.chooseImport, folder),
  chooseDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseDirectory),
  chooseRelink: () => ipcRenderer.invoke(IPC_CHANNELS.chooseRelink),
  preview: (id, recipe, maxDimension) =>
    ipcRenderer.invoke(IPC_CHANNELS.preview, id, recipe, maxDimension),
  // A scheme URL rather than a blob or data URL: the bytes are produced in the
  // main process, so the renderer never needs file-system access to show a
  // thumbnail, and the `revision` query defeats any stale cache entry.
  assetUrl: (id, revision) => `lumaflux://asset/${encodeURIComponent(id)}?revision=${revision}`,
  // The one case where the renderer hands the main process a real filesystem
  // path. `webUtils` is the supported way to resolve a dropped File; without it
  // `File.path` is gone in modern Electron and drag-and-drop import breaks.
  pathsForFiles: (files) =>
    files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  onChange: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(CATALOG_CHANGE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(CATALOG_CHANGE_CHANNEL, handler);
  },
  settings: () => ipcRenderer.invoke(IPC_CHANNELS.agentSettings),
  updateSettings: (enabled, roots) => ipcRenderer.invoke(IPC_CHANNELS.updateAgentSettings, enabled, roots),
};

contextBridge.exposeInMainWorld('lumaflux', api);
