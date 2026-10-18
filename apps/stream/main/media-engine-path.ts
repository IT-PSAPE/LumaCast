import { app } from 'electron';
import path from 'node:path';
import { mediaEngineExecutableName, toStreamPlatform } from '../shared/platform-capabilities';

export function bundledMediaEnginePath(): string {
  const executable = mediaEngineExecutableName(toStreamPlatform(process.platform));
  return app.isPackaged
    ? path.join(process.resourcesPath, 'media-engine', executable)
    : path.join(app.getAppPath(), 'vendor', 'ffmpeg', 'bin', executable);
}
