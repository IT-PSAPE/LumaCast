// Forbidden: even the react-allowed canvas package must never import
// electron (issue #219, W9 purity exemption is react/konva-only).
import { ipcRenderer } from 'electron';

export const thing = ipcRenderer;
