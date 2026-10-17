import { contextBridge, ipcRenderer } from 'electron';
import type { SoundboardAPI } from '../shared/desktop-api';
import { IPC_CHANNELS } from './ipc-channels';

const api: SoundboardAPI = {
  load: () => ipcRenderer.invoke(IPC_CHANNELS.load),
  createBoard: (name) => ipcRenderer.invoke(IPC_CHANNELS.createBoard, name),
  renameBoard: (boardId, name) => ipcRenderer.invoke(IPC_CHANNELS.renameBoard, boardId, name),
  importSounds: (boardId) => ipcRenderer.invoke(IPC_CHANNELS.importSounds, boardId),
  removeSound: (boardId, soundId) => ipcRenderer.invoke(IPC_CHANNELS.removeSound, boardId, soundId),
  updateSound: (boardId, soundId, settings) => ipcRenderer.invoke(IPC_CHANNELS.updateSound, boardId, soundId, settings),
};

contextBridge.exposeInMainWorld('soundboard', api);
