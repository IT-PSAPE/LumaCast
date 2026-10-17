import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AudioSettingsStore } from '../../../../apps/stream/main/audio-settings-store';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-audio-settings-'));
  temporaryDirectories.push(directory);
  return { directory, store: new AudioSettingsStore(directory) };
}

describe('Stream machine-local audio settings', () => {
  it('defaults to the system monitoring device when no settings file exists', async () => {
    const { store } = await createStore();
    await expect(store.load()).resolves.toEqual({ monitoringDeviceId: '' });
  });

  it('round-trips and replaces the selected monitoring device', async () => {
    const { store } = await createStore();
    await store.save({ monitoringDeviceId: 'usb-headphones-device-id' });
    await store.save({ monitoringDeviceId: 'hdmi-audio-device-id' });
    await expect(store.load()).resolves.toEqual({ monitoringDeviceId: 'hdmi-audio-device-id' });
  });

  it.each(['x'.repeat(513), 'invalid\u0000device'])('rejects invalid monitoring device IDs', async (monitoringDeviceId) => {
    const { store } = await createStore();
    await expect(store.save({ monitoringDeviceId })).rejects.toThrow('invalid audio monitoring device settings');
  });

  it('rejects malformed persisted settings instead of applying them', async () => {
    const { directory, store } = await createStore();
    await writeFile(path.join(directory, 'audio-settings.json'), JSON.stringify({ version: 1, monitoringDeviceId: 42 }), 'utf8');
    await expect(store.load()).rejects.toThrow('invalid audio monitoring device settings');
  });

  it('rejects an unsupported settings version', async () => {
    const { directory, store } = await createStore();
    await writeFile(path.join(directory, 'audio-settings.json'), JSON.stringify({ version: 2, monitoringDeviceId: '' }), 'utf8');
    await expect(store.load()).rejects.toThrow('invalid audio monitoring device settings');
  });
});
