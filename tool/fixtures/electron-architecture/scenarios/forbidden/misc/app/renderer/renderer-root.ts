import { ipcRenderer } from 'electron';
import { register } from '../main/ipc';

export function root(): void {
  void ipcRenderer;
  register();
}