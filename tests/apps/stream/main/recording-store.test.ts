// @vitest-environment node
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserWindow } from 'electron';
import type { RecordingOutputSettings, StreamRecordingPreferences } from '../../../../apps/stream/shared/desktop-api';

import { RecordingStore } from '../../../../apps/stream/main/recording-store';

const recordingSettings: RecordingOutputSettings = {
  container: 'mp4', frameRate: 30, videoBitrateKbps: 8000, audioBitrateKbps: 160, audioTracks: [1],
  rateControl: 'cbr', encoder: 'h264_mf', encoderQuality: 60, hardwareEncoding: false, keyframeIntervalSeconds: 2,
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function store(): RecordingStore {
  return new RecordingStore(() => null, 'videos');
}

describe('RecordingStore frame-rate validation', () => {
  it.each([1, 59.94, 240])('accepts %s FPS', async (frameRate) => {
    await expect(store().open({ ...recordingSettings, frameRate })).rejects.toThrow('The Stream window is not available.');
  });

  it.each([0, 0.99, 240.01, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid frame rates (%s)', async (frameRate) => {
    await expect(store().open({ ...recordingSettings, frameRate })).rejects.toThrow(/outside the supported range/);
  });
});

describe('RecordingStore destination and naming', () => {
  async function createConfiguredStore(directory: string, preferences: StreamRecordingPreferences): Promise<RecordingStore> {
    const window = { isDestroyed: () => false } as unknown as BrowserWindow;
    return new RecordingStore(() => window, directory, { load: async () => preferences });
  }

  it('creates recordings in the configured folder and avoids existing or concurrent filenames', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-recording-store-'));
    temporaryDirectories.push(directory);
    await writeFile(path.join(directory, 'Capture.mp4'), 'existing', 'utf8');
    const store = await createConfiguredStore(directory, { directory, filenameFormat: 'Capture' });

    const first = await store.open({ ...recordingSettings, audioTracks: [] });
    const second = await store.open({ ...recordingSettings, audioTracks: [] });

    expect(first?.name).toBe('Capture (2).mp4');
    expect(second?.name).toBe('Capture (3).mp4');
    await Promise.all([store.abort(first!.id), store.abort(second!.id)]);
    await expect(readdir(directory)).resolves.toEqual(['Capture.mp4']);
  });

  it('uses the Videos folder when no custom folder is configured', async () => {
    const videosDirectory = await mkdtemp(path.join(os.tmpdir(), 'lumastream-videos-'));
    temporaryDirectories.push(videosDirectory);
    const store = await createConfiguredStore(videosDirectory, { directory: '', filenameFormat: 'Default' });

    const recording = await store.open({ ...recordingSettings, audioTracks: [] });

    expect(recording?.name).toBe('Default.mp4');
    await store.abort(recording!.id);
    await expect(readdir(videosDirectory)).resolves.toEqual([]);
  });

  it('fails clearly when the configured recording directory is unavailable', async () => {
    const directory = path.join(os.tmpdir(), 'lumastream-recording-folder-missing');
    const store = await createConfiguredStore(directory, { directory, filenameFormat: 'Capture' });
    await expect(store.open({ ...recordingSettings, audioTracks: [] })).rejects.toThrow('Recording folder is unavailable or not writable');
  });
});
