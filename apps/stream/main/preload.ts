import { contextBridge, ipcRenderer } from 'electron';
import type { StreamAPI } from '../shared/desktop-api';
import { IPC_CHANNELS } from './ipc-channels';

const api: StreamAPI = {
  loadProject: () => ipcRenderer.invoke(IPC_CHANNELS.loadProject),
  saveProject: (collectionId, profileId, project) => ipcRenderer.invoke(IPC_CHANNELS.saveProject, collectionId, profileId, project),
  createCollection: (name, duplicateCurrent) => ipcRenderer.invoke(IPC_CHANNELS.createCollection, name, duplicateCurrent),
  activateCollection: (id) => ipcRenderer.invoke(IPC_CHANNELS.activateCollection, id),
  renameCollection: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.renameCollection, id, name),
  deleteCollection: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteCollection, id),
  importCollection: () => ipcRenderer.invoke(IPC_CHANNELS.importCollection),
  exportCollection: (id) => ipcRenderer.invoke(IPC_CHANNELS.exportCollection, id),
  createProfile: (name, duplicateCurrent) => ipcRenderer.invoke(IPC_CHANNELS.createProfile, name, duplicateCurrent),
  activateProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.activateProfile, id),
  renameProfile: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.renameProfile, id, name),
  deleteProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.deleteProfile, id),
  importProfile: () => ipcRenderer.invoke(IPC_CHANNELS.importProfile),
  exportProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.exportProfile, id),
  listDesktopSources: (kind) => ipcRenderer.invoke(IPC_CHANNELS.listDesktopSources, kind),
  prepareDesktopCapture: (sourceId, includeSystemAudio) => ipcRenderer.invoke(IPC_CHANNELS.prepareDesktopCapture, sourceId, includeSystemAudio),
  importMedia: (kind) => ipcRenderer.invoke(IPC_CHANNELS.importMedia, kind),
  remuxRecording: () => ipcRenderer.invoke(IPC_CHANNELS.remuxRecording),
  openRecording: (settings) => ipcRenderer.invoke(IPC_CHANNELS.openRecording, settings),
  writeRecordingChunk: (id, track, bytes) => ipcRenderer.invoke(IPC_CHANNELS.writeRecordingChunk, id, track, bytes),
  closeRecording: (id) => ipcRenderer.invoke(IPC_CHANNELS.closeRecording, id),
  abortRecording: (id) => ipcRenderer.invoke(IPC_CHANNELS.abortRecording, id),
  startStreaming: (destination, settings) => ipcRenderer.invoke(IPC_CHANNELS.startStreaming, destination, settings),
  writeStreamingChunk: (id, bytes) => ipcRenderer.invoke(IPC_CHANNELS.writeStreamingChunk, id, bytes),
  stopStreaming: (id) => ipcRenderer.invoke(IPC_CHANNELS.stopStreaming, id),
  setGlobalHotkeys: (hotkeys, sceneSwitchHotkeys, sourceVisibilityHotkeys) => ipcRenderer.invoke(IPC_CHANNELS.setGlobalHotkeys, hotkeys, sceneSwitchHotkeys, sourceVisibilityHotkeys),
  onGlobalHotkey(listener) {
    const handler = (_event: Electron.IpcRendererEvent, action: Parameters<typeof listener>[0]) => listener(action);
    ipcRenderer.on(IPC_CHANNELS.globalHotkey, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.globalHotkey, handler);
  },
  onStreamStatus(listener) {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof listener>[0]) => listener(status);
    ipcRenderer.on(IPC_CHANNELS.streamStatus, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.streamStatus, handler);
  },
  createBrowserSource: (id, url, width, height) => ipcRenderer.invoke(IPC_CHANNELS.createBrowserSource, id, url, width, height),
  getBrowserSourceAudioCaptureId: (id) => ipcRenderer.invoke(IPC_CHANNELS.getBrowserSourceAudioCaptureId, id),
  closeBrowserSource: (id) => ipcRenderer.invoke(IPC_CHANNELS.closeBrowserSource, id),
  onBrowserSourceFrame(listener) {
    const handler = (_event: Electron.IpcRendererEvent, id: string, frame: ArrayBuffer) => listener(id, frame);
    ipcRenderer.on(IPC_CHANNELS.browserSourceFrame, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.browserSourceFrame, handler);
  },
};

contextBridge.exposeInMainWorld('streamApi', api);
