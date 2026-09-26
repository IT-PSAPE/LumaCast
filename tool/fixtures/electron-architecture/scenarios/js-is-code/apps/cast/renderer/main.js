// Forbidden: a .js file is code, not an asset. Classifying it as anything else
// lets it import main-process code while every renderer rule skips it.
import { ipcMain } from 'electron';

export const openWindow = () => ipcMain;
