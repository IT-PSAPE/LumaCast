import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallRecordStore } from '../../../../apps/cloud/main/suite/install-records';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lumacloud-installs-'));
  filePath = path.join(dir, 'installs.json');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const cast = { app: 'cast', version: '1.2.3', location: '/a/LumaCast.app', scope: 'user' } as const;

describe('apps/cloud InstallRecordStore', () => {
  it('starts empty when no file exists', async () => {
    const store = await InstallRecordStore.open(filePath);
    expect(store.get('cast', 'user')).toBeUndefined();
  });

  it('round-trips records through a fresh open, keyed per app and scope', async () => {
    const store = await InstallRecordStore.open(filePath);
    await store.set(cast);
    await store.set({ ...cast, scope: 'system', location: '/Applications/LumaCast.app' });
    const reopened = await InstallRecordStore.open(filePath);
    expect(reopened.get('cast', 'user')).toEqual(cast);
    expect(reopened.get('cast', 'system')?.location).toBe('/Applications/LumaCast.app');
    expect(reopened.get('flux', 'user')).toBeUndefined();
  });

  it('remove drops one scope and persists it', async () => {
    const store = await InstallRecordStore.open(filePath);
    await store.set(cast);
    await store.remove('cast', 'user');
    expect((await InstallRecordStore.open(filePath)).get('cast', 'user')).toBeUndefined();
  });

  it('degrades to empty on a corrupt file', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeFile(filePath, '{not json');
    expect((await InstallRecordStore.open(filePath)).get('cast', 'user')).toBeUndefined();
  });

  it('ignores records for unknown app ids', async () => {
    await writeFile(
      filePath,
      JSON.stringify({ records: [{ app: 'ghost', scope: 'user', location: '/x', version: '1' }, cast] }),
    );
    const store = await InstallRecordStore.open(filePath);
    expect(store.get('cast', 'user')).toEqual(cast);
    expect(JSON.parse(await readFile(filePath, 'utf8')).records).toHaveLength(2);
  });

  it('serializes concurrent writes without losing any', async () => {
    const store = await InstallRecordStore.open(filePath);
    await Promise.all([store.set(cast), store.set({ ...cast, app: 'flux' })]);
    const reopened = await InstallRecordStore.open(filePath);
    expect(reopened.get('cast', 'user')).toBeDefined();
    expect(reopened.get('flux', 'user')).toBeDefined();
  });
});
