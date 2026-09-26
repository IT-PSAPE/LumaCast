// The one and only surface the renderer can reach. It is a fixed set of
// channels over `ipcRenderer.invoke`; the renderer never sees a module
// namespace, a file path, or an `ipcRenderer` handle, and main independently
// validates that every invocation comes from this window's main frame (see
// main/ipc.ts's registerIpc).
//
// `window.lumachord` is the global ChordDesktopAPI declares
// (shared/desktop-api.ts); only the implementation behind it lives here.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ChordDesktopAPI } from '../shared/desktop-api';
import { IPC_CHANNELS, MENU_COMMAND_CHANNEL, OPEN_DOCUMENT_CHANNEL } from './ipc-channels';

const api: ChordDesktopAPI = {
  newProject: () => ipcRenderer.invoke(IPC_CHANNELS.newProject),
  openProject: (path) => ipcRenderer.invoke(IPC_CHANNELS.openProject, path),
  saveProject: (document, options) => ipcRenderer.invoke(IPC_CHANNELS.saveProject, document, options),
  recentProjects: () => ipcRenderer.invoke(IPC_CHANNELS.recentProjects),
  setDocumentState: (state) => ipcRenderer.invoke(IPC_CHANNELS.setDocumentState, state),

  importMedia: (kind) => ipcRenderer.invoke(IPC_CHANNELS.importMedia, kind),
  admitFiles: (paths) => ipcRenderer.invoke(IPC_CHANNELS.admitFiles, paths),
  // The one case where the renderer hands the main process a real filesystem
  // path. `webUtils` is the supported way to resolve a dropped File; without
  // it `File.path` is gone in modern Electron and drag-and-drop import
  // breaks. Resolved entirely in preload — no IPC round trip needed.
  pathsForFiles: (files) => files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  mediaUrl: (path) => ipcRenderer.invoke(IPC_CHANNELS.mediaUrl, path),
  readCueFile: (path) => ipcRenderer.invoke(IPC_CHANNELS.readCueFile, path),

  exportCues: (text, format, suggestedName) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportCues, text, format, suggestedName),

  chooseExportPath: (suggestedName, extension) =>
    ipcRenderer.invoke(IPC_CHANNELS.chooseExportPath, suggestedName, extension),
  exportOpen: (path) => ipcRenderer.invoke(IPC_CHANNELS.exportOpen, path),
  exportWrite: (sinkId, position, bytes) => ipcRenderer.invoke(IPC_CHANNELS.exportWrite, sinkId, position, bytes),
  exportClose: (sinkId) => ipcRenderer.invoke(IPC_CHANNELS.exportClose, sinkId),
  exportAbort: (sinkId) => ipcRenderer.invoke(IPC_CHANNELS.exportAbort, sinkId),
  revealPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.revealPath, path),

  onMenuCommand: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, command: Parameters<typeof callback>[0]) => callback(command);
    ipcRenderer.on(MENU_COMMAND_CHANNEL, handler);
    return () => ipcRenderer.removeListener(MENU_COMMAND_CHANNEL, handler);
  },
  onOpenDocument: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, document: Parameters<typeof callback>[0]) => callback(document);
    ipcRenderer.on(OPEN_DOCUMENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(OPEN_DOCUMENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('lumachord', api);
