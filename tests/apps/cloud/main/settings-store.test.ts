import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../../../../apps/cloud/main/suite/settings-store';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lumacloud-settings-'));
  filePath = path.join(dir, 'settings.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('apps/cloud SettingsStore', () => {
  it('starts from defaults when no file exists', async () => {
    const store = await SettingsStore.open(filePath);
    expect(store.get()).toEqual({ installScope: 'user', checkOnLaunch: true, grants: [] });
  });

  it('round-trips a write through a fresh SettingsStore.open', async () => {
    const store = await SettingsStore.open(filePath);
    await store.update({ installScope: 'system', checkOnLaunch: false });
    await store.grant('cast', 'com.lumacast.app');

    const reopened = await SettingsStore.open(filePath);
    const settings = reopened.get();
    expect(settings.installScope).toBe('system');
    expect(settings.checkOnLaunch).toBe(false);
    expect(settings.grants).toEqual([
      { app: 'cast', bundleId: 'com.lumacast.app', grantedAt: expect.any(String) },
    ]);
  });

  it('writes the settings file with restrictive (0o600) permissions', async () => {
    const store = await SettingsStore.open(filePath);
    await store.update({ checkOnLaunch: false });
    const stats = await import('node:fs/promises').then((fs) => fs.stat(filePath));
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('falls back to defaults, logging, when the file is invalid JSON', async () => {
    await writeFile(filePath, '{ not valid json', 'utf8');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = await SettingsStore.open(filePath);

    expect(store.get()).toEqual({ installScope: 'user', checkOnLaunch: true, grants: [] });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('falls back to defaults when the file is well-formed JSON of the wrong shape', async () => {
    await writeFile(filePath, JSON.stringify({ installScope: 'nonsense' }), 'utf8');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = await SettingsStore.open(filePath);

    expect(store.get()).toEqual({ installScope: 'user', checkOnLaunch: true, grants: [] });
    consoleError.mockRestore();
  });

  it('falls back to defaults when a grant names an app id that no longer exists', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        installScope: 'user',
        checkOnLaunch: true,
        grants: [{ app: 'not-a-real-app', bundleId: 'com.lumacast.not-a-real-app', grantedAt: '2026-01-01T00:00:00.000Z' }],
      }),
      'utf8',
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = await SettingsStore.open(filePath);

    expect(store.get().grants).toEqual([]);
    consoleError.mockRestore();
  });

  it('grants idempotently: granting an already-granted app does not duplicate it', async () => {
    const store = await SettingsStore.open(filePath);
    await store.grant('cast', 'com.lumacast.app');
    const settings = await store.grant('cast', 'com.lumacast.app');
    expect(settings.grants).toHaveLength(1);
  });

  it('revokes idempotently: revoking an ungranted app is a no-op', async () => {
    const store = await SettingsStore.open(filePath);
    const settings = await store.revoke('flux');
    expect(settings.grants).toEqual([]);
  });

  it('revoke removes exactly the granted app', async () => {
    const store = await SettingsStore.open(filePath);
    await store.grant('cast', 'com.lumacast.app');
    await store.grant('flux', 'app.lumaflux.desktop');
    const settings = await store.revoke('cast');
    expect(settings.grants).toEqual([
      { app: 'flux', bundleId: 'app.lumaflux.desktop', grantedAt: expect.any(String) },
    ]);
  });

  it('refuses to grant Cloud its own identity', async () => {
    const store = await SettingsStore.open(filePath);
    const settings = await store.grant('cloud', 'com.lumacast.cloud');
    expect(settings.grants).toEqual([]);
  });

  it('refuses a grant whose bundle id does not match the app', async () => {
    const store = await SettingsStore.open(filePath);
    // Flux's real identity, asked to authorise Cast: bundle id mismatch.
    const settings = await store.grant('cast', 'app.lumaflux.desktop');
    expect(settings.grants).toEqual([]);
  });

  it('refuses a grant whose bundle id is not a managed identity at all', async () => {
    const store = await SettingsStore.open(filePath);
    const settings = await store.grant('cast', 'com.evil.app');
    expect(settings.grants).toEqual([]);
  });

  it('get() returns a defensive copy: mutating it does not affect the store', async () => {
    const store = await SettingsStore.open(filePath);
    await store.grant('cast', 'com.lumacast.app');
    const settings = store.get();
    settings.grants.push({ app: 'flux', bundleId: 'app.lumaflux.desktop', grantedAt: 'x' });
    expect(store.get().grants).toHaveLength(1);
  });

  it('reads back what a second store instance concurrently persisted', async () => {
    const store = await SettingsStore.open(filePath);
    await Promise.all([
      store.grant('cast', 'com.lumacast.app'),
      store.grant('flux', 'app.lumaflux.desktop'),
      store.update({ checkOnLaunch: false }),
    ]);
    const settings = store.get();
    expect(settings.checkOnLaunch).toBe(false);
    expect(settings.grants.map((g) => g.app).sort()).toEqual(['cast', 'flux']);

    const onDisk = JSON.parse(await readFile(filePath, 'utf8'));
    expect(onDisk).toEqual(settings);
  });
});
