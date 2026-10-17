import { app } from 'electron';
import path from 'node:path';

export function bundledMediaEnginePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'media-engine', 'ffmpeg.exe')
    : path.join(app.getAppPath(), 'vendor', 'ffmpeg', 'bin', 'ffmpeg.exe');
}
