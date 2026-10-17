import { mkdirSync } from 'node:fs';

/** Electron requires the userData directory to exist before app.setPath(). */
export function prepareUserDataDirectory(directory: string, setPath: (name: 'userData', value: string) => void): void {
  mkdirSync(directory, { recursive: true });
  setPath('userData', directory);
}
