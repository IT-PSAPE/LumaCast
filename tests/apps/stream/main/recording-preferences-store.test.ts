import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RecordingPreferencesStore } from '../../../../apps/stream/main/recording-preferences-store';
import { createDefaultStreamRecordingPreferences } from '../../../../apps/stream/shared/desktop-api';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-recording-preferences-'));
  temporaryDirectories.push(directory);
  return { directory, store: new RecordingPreferencesStore(directory) };
}

describe('Stream machine-local recording preferences', () => {
  it('defaults to the Videos folder and OBS-style date tokens', async () => {
    const { store } = await createStore();
    await expect(store.load()).resolves.toEqual(createDefaultStreamRecordingPreferences());
  });

  it('round-trips the selected folder and filename format', async () => {
    const { directory, store } = await createStore();
    const preferences = { directory, filenameFormat: 'Stream %CCYY-%MM-%DD' };
    await store.save(preferences);
    await expect(store.load()).resolves.toEqual(preferences);
  });

  it('merges concurrent updates without restoring stale preference fields', async () => {
    const { directory, store } = await createStore();
    const recordingDirectory = path.join(directory, 'Videos');
    await store.save({ directory: '', filenameFormat: 'Before' });

    await Promise.all([
      store.update({ filenameFormat: 'After' }),
      store.update({ directory: recordingDirectory }),
    ]);

    await expect(store.load()).resolves.toEqual({ directory: recordingDirectory, filenameFormat: 'After' });
  });

  it.each([
    { directory: 'relative-folder', filenameFormat: 'Capture' },
    { directory: 'C:\\Videos\u0000', filenameFormat: 'Capture' },
    { directory: '', filenameFormat: 'Bad/Name' },
    { directory: '', filenameFormat: 'Bad %unknown' },
    { directory: '', filenameFormat: 'CON' },
  ])('rejects invalid preferences %#', async (preferences) => {
    const { store } = await createStore();
    await expect(store.save(preferences)).rejects.toThrow('invalid recording preferences');
  });

  it('rejects malformed persisted settings instead of applying them', async () => {
    const { directory, store } = await createStore();
    await writeFile(path.join(directory, 'recording-preferences.json'), JSON.stringify({ version: 1, directory: 42, filenameFormat: 'Capture' }), 'utf8');
    await expect(store.load()).rejects.toThrow('invalid recording preferences');
  });

  it('rejects an unsupported settings version', async () => {
    const { directory, store } = await createStore();
    await writeFile(path.join(directory, 'recording-preferences.json'), JSON.stringify({ version: 2, directory: '', filenameFormat: 'Capture' }), 'utf8');
    await expect(store.load()).rejects.toThrow('invalid recording preferences');
  });
});
