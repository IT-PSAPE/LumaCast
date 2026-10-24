import { contextBridge, ipcRenderer } from 'electron';
import type { StreamAPI } from '../shared/desktop-api';
import { IPC_CHANNELS } from './ipc-channels';
import { toStreamPlatform } from '../shared/platform-capabilities';

const api: StreamAPI = {
  platform: toStreamPlatform(process.platform),
  loadProject: () => ipcRenderer.invoke(IPC_CHANNELS.loadProject),
  saveProject: (collectionId, profileId, project) => ipcRenderer.invoke(IPC_CHANNELS.saveProject, collectionId, profileId, project),
  loadAudioSettings: () => ipcRenderer.invoke(IPC_CHANNELS.loadAudioSettings),
  saveAudioSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.saveAudioSettings, settings),
  loadRecordingPreferences: () => ipcRenderer.invoke(IPC_CHANNELS.loadRecordingPreferences),
  saveRecordingFilenameFormat: (filenameFormat) => ipcRenderer.invoke(IPC_CHANNELS.saveRecordingFilenameFormat, filenameFormat),
  chooseRecordingDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.chooseRecordingDirectory),
  useDefaultRecordingDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.useDefaultRecordingDirectory),
  showRecordingsFolder: () => ipcRenderer.invoke(IPC_CHANNELS.showRecordingsFolder),
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
  listAudioApplications: () => ipcRenderer.invoke(IPC_CHANNELS.listAudioApplications),
  startApplicationAudioCapture: (sourceId, pid, applicationPath) => ipcRenderer.invoke(IPC_CHANNELS.startApplicationAudioCapture, sourceId, pid, applicationPath),
  startSystemAudioCapture: (sourceId) => ipcRenderer.invoke(IPC_CHANNELS.startSystemAudioCapture, sourceId),
  stopApplicationAudioCapture: (sourceId) => ipcRenderer.invoke(IPC_CHANNELS.stopApplicationAudioCapture, sourceId),
  onApplicationAudioFrame(listener) {
    const ports = new Set<MessagePort>();
    const handler = (event: Electron.IpcRendererEvent, sourceId: string) => {
      const port = event.ports[0];
      if (!port) return;
      ports.add(port);
      port.onmessage = ({ data }) => {
        if (data instanceof ArrayBuffer) listener(sourceId, data);
        else if (data && typeof data === 'object' && typeof data.error === 'string') {
          listener(sourceId, { error: data.error });
          ports.delete(port);
          port.close();
        }
      };
      port.onmessageerror = () => {
        ports.delete(port);
        listener(sourceId, { error: 'Application audio capture could not transfer audio.' });
        port.close();
      };
      port.addEventListener('close', () => ports.delete(port), { once: true });
      port.start();
    };
    ipcRenderer.on(IPC_CHANNELS.applicationAudioFrame, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.applicationAudioFrame, handler);
      for (const port of ports) port.close();
      ports.clear();
    };
  },
  importMedia: (kind) => ipcRenderer.invoke(IPC_CHANNELS.importMedia, kind),
  remuxRecording: () => ipcRenderer.invoke(IPC_CHANNELS.remuxRecording),
  openRecording: (settings) => ipcRenderer.invoke(IPC_CHANNELS.openRecording, settings),
  writeRecordingChunk: (id, track, bytes) => ipcRenderer.invoke(IPC_CHANNELS.writeRecordingChunk, id, track, bytes),
  closeRecording: (id) => ipcRenderer.invoke(IPC_CHANNELS.closeRecording, id),
  abortRecording: (id) => ipcRenderer.invoke(IPC_CHANNELS.abortRecording, id),
  startStreaming: (destination, settings, outputId) => ipcRenderer.invoke(IPC_CHANNELS.startStreaming, destination, settings, outputId),
  getYouTubeAccount: () => ipcRenderer.invoke(IPC_CHANNELS.getYouTubeAccount),
  connectYouTubeAccount: () => ipcRenderer.invoke(IPC_CHANNELS.connectYouTubeAccount),
  disconnectYouTubeAccount: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectYouTubeAccount),
  listYouTubeBroadcasts: () => ipcRenderer.invoke(IPC_CHANNELS.listYouTubeBroadcasts),
  getYouTubeLiveDetails: (broadcastId) => ipcRenderer.invoke(IPC_CHANNELS.getYouTubeLiveDetails, broadcastId),
  createYouTubeBroadcast: (draft) => ipcRenderer.invoke(IPC_CHANNELS.createYouTubeBroadcast, draft),
  startYouTubeStreaming: (broadcastId, settings) => ipcRenderer.invoke(IPC_CHANNELS.startYouTubeStreaming, broadcastId, settings),
  getZoomAccount: () => ipcRenderer.invoke(IPC_CHANNELS.getZoomAccount),
  connectZoomAccount: () => ipcRenderer.invoke(IPC_CHANNELS.connectZoomAccount),
  disconnectZoomAccount: () => ipcRenderer.invoke(IPC_CHANNELS.disconnectZoomAccount),
  listZoomMeetings: () => ipcRenderer.invoke(IPC_CHANNELS.listZoomMeetings),
  createZoomMeeting: (draft) => ipcRenderer.invoke(IPC_CHANNELS.createZoomMeeting, draft),
  startZoomStreaming: (meetingId, settings) => ipcRenderer.invoke(IPC_CHANNELS.startZoomStreaming, meetingId, settings),
  stopZoomStreaming: (id) => ipcRenderer.invoke(IPC_CHANNELS.stopZoomStreaming, id),
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
  loadStreamServiceSettings: () => ipcRenderer.invoke(IPC_CHANNELS.loadStreamServiceSettings),
  saveStreamServiceSettings: (settings) => ipcRenderer.invoke(IPC_CHANNELS.saveStreamServiceSettings, settings),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  getRuntimeStats: () => ipcRenderer.invoke(IPC_CHANNELS.runtimeStats),
  setApplicationMenu: (template) => ipcRenderer.invoke(IPC_CHANNELS.setApplicationMenu, template),
  onMenuAction(listener) {
    const handler = (_event: Electron.IpcRendererEvent, id: string) => listener(id);
    ipcRenderer.on(IPC_CHANNELS.menuAction, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.menuAction, handler);
  },
};

ipcRenderer.on(IPC_CHANNELS.zoomMediaPort, (event, sessionId: string) => {
  const port = event.ports[0];
  if (!port || typeof sessionId !== 'string') return;
  window.postMessage({ source: 'lumastream-main', type: 'zoom-media-port', sessionId }, '*', [port]);
});

contextBridge.exposeInMainWorld('streamApi', api);
