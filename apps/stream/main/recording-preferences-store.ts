import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDefaultStreamRecordingPreferences, type StreamRecordingPreferences } from '../shared/desktop-api';
import { validateRecordingFilenameFormat } from '../shared/recording-filename';

function decodeRecordingPreferences(value: unknown): StreamRecordingPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Stream contains invalid recording preferences.');
  const preferences = value as Partial<StreamRecordingPreferences>;
  if (typeof preferences.directory !== 'string' || preferences.directory.length > 32768
    || /[\u0000-\u001f\u007f]/.test(preferences.directory)
    || (preferences.directory !== '' && !path.isAbsolute(preferences.directory))
    || !validateRecordingFilenameFormat(preferences.filenameFormat)) {
    throw new Error('Stream contains invalid recording preferences.');
  }
  return { directory: preferences.directory, filenameFormat: preferences.filenameFormat };
}

function decodePersistedRecordingPreferences(value: unknown): StreamRecordingPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as { version?: unknown }).version !== 1) {
    throw new Error('Stream contains invalid recording preferences.');
  }
  return decodeRecordingPreferences(value);
}

export class RecordingPreferencesStore {
  private readonly filePath: string;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDirectory: string) {
    this.filePath = path.join(dataDirectory, 'recording-preferences.json');
  }

  async load(): Promise<StreamRecordingPreferences> {
    try {
      const bytes = await readFile(this.filePath);
      if (bytes.length > 16 * 1024) throw new Error('Stream recording preferences are too large.');
      return decodePersistedRecordingPreferences(JSON.parse(bytes.toString('utf8')));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return createDefaultStreamRecordingPreferences();
      }
      throw error;
    }
  }

  async save(value: unknown): Promise<void> {
    const preferences = decodeRecordingPreferences(value);
    const saving = this.saveQueue.then(() => this.persist(preferences));
    this.saveQueue = saving.catch(() => undefined);
    await saving;
  }

  async update(patch: Partial<StreamRecordingPreferences>): Promise<StreamRecordingPreferences> {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Stream contains invalid recording preferences.');
    const updating = this.saveQueue.then(async () => {
      const current = await this.load();
      const next = decodeRecordingPreferences({ ...current, ...patch });
      await this.persist(next);
      return next;
    });
    this.saveQueue = updating.then(() => undefined, () => undefined);
    return updating;
  }

  private async persist(preferences: StreamRecordingPreferences): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify({ version: 1, ...preferences }), 'utf8');
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
