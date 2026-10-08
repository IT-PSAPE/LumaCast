import { contextBridge, ipcRenderer } from 'electron';
import type { NdiGpuOutputApi, NdiGpuSceneSnapshot } from '@lumacast/protocol';
// Keep the sandbox preload self-contained; contract tests verify these channel names.
const NDI_GPU_SCENE_CHANNEL = 'ndi:gpuScene';
const NDI_GPU_SCENE_READY_CHANNEL = 'ndi:gpuSceneReady';
const api: NdiGpuOutputApi = {
  onScene(callback) {
    const listener = (_event: Electron.IpcRendererEvent, scene: NdiGpuSceneSnapshot) => callback(scene);
    ipcRenderer.on(NDI_GPU_SCENE_CHANNEL, listener);
    return () => ipcRenderer.removeListener(NDI_GPU_SCENE_CHANNEL, listener);
  },
  ready(revisionId) { ipcRenderer.send(NDI_GPU_SCENE_READY_CHANNEL, revisionId); },
};
contextBridge.exposeInMainWorld('ndiGpuApi', api);
