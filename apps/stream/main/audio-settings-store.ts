import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDefaultStreamAudioSettings, type StreamAudioSettings } from '../shared/desktop-api';

function decodeAudioSettings(value: unknown): StreamAudioSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Stream contains invalid audio settings.');
  const settings = value as Partial<StreamAudioSettings>;
  if (typeof settings.monitoringDeviceId !== 'string' || settings.monitoringDeviceId.length > 512
    || /[\u0000-\u001f\u007f]/.test(settings.monitoringDeviceId)) {
    throw new Error('Stream contains invalid audio monitoring device settings.');
  }
  return { monitoringDeviceId: settings.monitoringDeviceId };
}

function decodePersistedAudioSettings(value: unknown): StreamAudioSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { version?: unknown }).version !== 1) {
    throw new Error('Stream contains invalid audio monitoring device settings.');
  }
  return decodeAudioSettings(value);
}

export class AudioSettingsStore {
  private readonly filePath: string;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDirectory: string) {
    this.filePath = path.join(dataDirectory, 'audio-settings.json');
  }

  async load(): Promise<StreamAudioSettings> {
    try {
      const bytes = await readFile(this.filePath);
      if (bytes.length > 16 * 1024) throw new Error('Stream audio settings are too large.');
      return decodePersistedAudioSettings(JSON.parse(bytes.toString('utf8')));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return createDefaultStreamAudioSettings();
      }
      throw error;
    }
  }

  async save(value: unknown): Promise<void> {
    const settings = decodeAudioSettings(value);
    const saving = this.saveQueue.then(() => this.persist(settings));
    this.saveQueue = saving.catch(() => undefined);
    await saving;
  }

  private async persist(settings: StreamAudioSettings): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify({ version: 1, ...settings }), 'utf8');
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
