// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`, 'utf8')),
    decryptString: vi.fn((buffer: Buffer) => {
      const text = buffer.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('Unable to decrypt.');
      return text.slice('enc:'.length);
    }),
  },
}));

import { safeStorage } from 'electron';
import { StreamSettingsStore } from '../../../../apps/stream/main/stream-settings-store';
import { createDefaultStreamServiceSettings } from '../../../../apps/stream/shared/desktop-api';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  vi.mocked(safeStorage.encryptString).mockClear();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-stream-settings-'));
  temporaryDirectories.push(directory);
  return { directory, store: new StreamSettingsStore(directory) };
}

describe('Stream service settings store', () => {
  it('defaults to YouTube with an empty key when no file exists', async () => {
    const { store } = await createStore();
    await expect(store.load()).resolves.toEqual(createDefaultStreamServiceSettings());
  });

  it('round-trips settings and encrypts the key with safeStorage when available', async () => {
    const { directory, store } = await createStore();
    const settings = {
      ...createDefaultStreamServiceSettings(),
      streamKey: 'super-secret-key',
      youtube: { title: 'My stream', description: 'Details', privacy: 'public' as const },
    };
    await store.save(settings);

    const persisted = JSON.parse(await readFile(path.join(directory, 'stream-settings.json'), 'utf8'));
    expect(persisted.streamKeyEncoding).toBe('safe-storage');
    expect(persisted.streamKey).not.toContain('super-secret-key');
    expect(safeStorage.encryptString).toHaveBeenCalledWith('super-secret-key');

    await expect(store.load()).resolves.toEqual(settings);
  });

  it('falls back to plain-text storage when encryption is unavailable', async () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    const { directory, store } = await createStore();
    const settings = { ...createDefaultStreamServiceSettings(), streamKey: 'plain-key' };
    await store.save(settings);

    const persisted = JSON.parse(await readFile(path.join(directory, 'stream-settings.json'), 'utf8'));
    expect(persisted.streamKeyEncoding).toBe('plain');
    expect(persisted.streamKey).toBe('plain-key');
    expect(safeStorage.encryptString).not.toHaveBeenCalled();

    await expect(store.load()).resolves.toEqual(settings);
  });

  it('never writes the stream key in plaintext when encryption is available', async () => {
    const { directory, store } = await createStore();
    await store.save({ ...createDefaultStreamServiceSettings(), streamKey: 'do-not-leak' });
    const raw = await readFile(path.join(directory, 'stream-settings.json'), 'utf8');
    expect(raw).not.toContain('do-not-leak');
  });

  it('falls back to defaults when the persisted file is corrupt', async () => {
    const { directory, store } = await createStore();
    await writeFile(path.join(directory, 'stream-settings.json'), '{not valid json', 'utf8');
    await expect(store.load()).resolves.toEqual(createDefaultStreamServiceSettings());
  });

  it('falls back to defaults for an unsupported settings version', async () => {
    const { directory, store } = await createStore();
    await writeFile(path.join(directory, 'stream-settings.json'), JSON.stringify({ version: 2 }), 'utf8');
    await expect(store.load()).resolves.toEqual(createDefaultStreamServiceSettings());
  });

  it('normalizes an unknown service and server instead of throwing', async () => {
    const { directory, store } = await createStore();
    await writeFile(path.join(directory, 'stream-settings.json'), JSON.stringify({
      version: 1,
      service: 'not-a-real-service',
      serverId: 'bogus',
      customServer: '',
      streamKeyEncoding: 'plain',
      streamKey: 'key',
      youtube: { title: '', description: '', privacy: 'unlisted' },
    }), 'utf8');

    const loaded = await store.load();
    expect(loaded.service).toBe('youtube');
    expect(loaded.serverId).toBe('primary');
  });

  it('clamps oversized strings on load', async () => {
    const { directory, store } = await createStore();
    await writeFile(path.join(directory, 'stream-settings.json'), JSON.stringify({
      version: 1,
      service: 'youtube',
      serverId: 'primary',
      customServer: '',
      streamKeyEncoding: 'plain',
      streamKey: 'k'.repeat(600),
      youtube: { title: 't'.repeat(200), description: 'd'.repeat(6000), privacy: 'unlisted' },
    }), 'utf8');

    const loaded = await store.load();
    expect(loaded.streamKey).toHaveLength(512);
    expect(loaded.youtube.title).toHaveLength(100);
    expect(loaded.youtube.description).toHaveLength(5000);
  });
});
