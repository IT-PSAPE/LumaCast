import { mkdtemp, readFile, readdir, rm, writeFile, lstat, mkdir, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryStore } from '../../../../apps/soundboard/main/library-store';

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'soundboard-'));
  roots.push(root);
  return { root, store: new LibraryStore(root) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('soundboard library store', () => {
  it('initializes a versioned empty library and serializes board mutations', async () => {
    const { root, store } = await setup();
    const [first, second] = await Promise.all([store.createBoard('Effects'), store.createBoard('Music')]);
    expect(first.boards).toHaveLength(1);
    expect(second.boards.map((board) => board.name)).toEqual(['Effects', 'Music']);
    expect(JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8'))).toEqual(second);
  });

  it('trims and validates names and rejects malformed manifests', async () => {
    const { root, store } = await setup();
    await expect(store.createBoard('   ')).rejects.toThrow(/name/);
    const manifest = path.join(root, 'library.json');
    // A well-formed version 2 manifest must load, not be treated as malformed.
    await writeFile(manifest, '{"version":2,"boards":[]}');
    await expect(new LibraryStore(root).load()).resolves.toEqual({ version: 2, boards: [] });
    for (const malformed of ['{"version":3,"boards":[]}', '{"version":2}', '{"version":2,"boards":{}}', '[]']) {
      await writeFile(manifest, malformed);
      await expect(new LibraryStore(root).load()).rejects.toThrow(/invalid format/);
      // The unreadable manifest is left on disk for repair rather than overwritten.
      expect(await readFile(manifest, 'utf8')).toBe(malformed);
    }
  });

  it('copies supported imports into managed storage and deletes removed audio', async () => {
    const { root, store } = await setup();
    const board = (await store.createBoard('Effects')).boards[0];
    const source = path.join(root, 'door.wav');
    await writeFile(source, Buffer.from([1, 2, 3]));
    const imported = await store.importSounds(board.id, [source]);
    const sound = imported.boards[0].sounds[0];
    expect(sound.name).toBe('door');
    expect(sound.fileName).toBe(`${sound.id}.wav`);
    expect((await lstat(path.join(root, 'audio', sound.fileName))).isFile()).toBe(true);
    expect((await store.removeSound(board.id, sound.id)).boards[0].sounds).toEqual([]);
    await expect(lstat(path.join(root, 'audio', sound.fileName))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves the library untouched if a batch import contains an unsupported file', async () => {
    const { root, store } = await setup();
    const board = (await store.createBoard('Effects')).boards[0];
    const good = path.join(root, 'good.mp3');
    const bad = path.join(root, 'bad.exe');
    await writeFile(good, 'audio');
    await writeFile(bad, 'nope');
    await expect(store.importSounds(board.id, [good, bad])).rejects.toThrow(/Unsupported/);
    expect((await store.load()).boards[0].sounds).toEqual([]);
    expect(await readdir(path.join(root, 'audio'))).toEqual([]);
  });

  it('normalizes empty and overlong imported names so the manifest remains loadable', async () => {
    const { root, store } = await setup();
    const board = (await store.createBoard('Effects')).boards[0];
    const hiddenName = path.join(root, '   .mp3');
    const longName = path.join(root, `${'a'.repeat(130)}.wav`);
    await writeFile(hiddenName, 'audio');
    await writeFile(longName, 'audio');
    const imported = await store.importSounds(board.id, [hiddenName, longName]);
    expect(imported.boards[0].sounds.map((sound) => sound.name)).toEqual(['Untitled sound', 'a'.repeat(100)]);
    expect((await new LibraryStore(root).load()).boards[0].sounds).toHaveLength(2);
  });

  it('recovers from a rejected initial load after the manifest is repaired', async () => {
    const { root } = await setup();
    await writeFile(path.join(root, 'library.json'), '{broken');
    const store = new LibraryStore(root);
    await expect(store.load()).rejects.toThrow();
    await writeFile(path.join(root, 'library.json'), '{"version":2,"boards":[]}');
    expect((await store.load()).boards).toEqual([]);
  });

  it('migrates version 1 libraries atomically and normalizes playback defaults across reloads', async () => {
    const { root } = await setup();
    const legacy = {
      version: 1,
      boards: [{
        id: '26a00123-1234-4234-8234-123456789013',
        name: 'Legacy',
        sounds: [{ id: '26a00123-1234-4234-8234-123456789012', name: 'Door', fileName: '26a00123-1234-4234-8234-123456789012.wav' }],
      }],
    };
    await writeFile(path.join(root, 'library.json'), JSON.stringify(legacy));
    const migrated = await new LibraryStore(root).load();
    expect(migrated.version).toBe(2);
    expect(migrated.boards[0].sounds[0].playback).toEqual({ startTime: 0, endTime: null, loop: false, shortcut: null });
    expect(JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8'))).toEqual(migrated);
    expect(await new LibraryStore(root).load()).toEqual(migrated);
  });

  it('leaves malformed version 1 manifests unchanged when migration validation fails', async () => {
    const { root } = await setup();
    const legacy = JSON.stringify({ version: 1, boards: [{ id: 'bad', name: 'Legacy', sounds: [] }] });
    const manifest = path.join(root, 'library.json');
    await writeFile(manifest, legacy);
    await expect(new LibraryStore(root).load()).rejects.toThrow(/invalid board/);
    expect(await readFile(manifest, 'utf8')).toBe(legacy);
  });

  it('validates playback ranges, shortcut codes and strict setting fields', async () => {
    const { root, store } = await setup();
    const board = (await store.createBoard('Effects')).boards[0];
    const source = path.join(root, 'door.wav');
    await writeFile(source, 'audio');
    const sound = (await store.importSounds(board.id, [source])).boards[0].sounds[0];
    const settings = { startTime: 0, endTime: null, loop: false, shortcut: null };
    await expect(store.updateSound(board.id, sound.id, { ...settings, startTime: Number.NaN })).rejects.toThrow(/playback/);
    await expect(store.updateSound(board.id, sound.id, { ...settings, startTime: 4, endTime: 4 })).rejects.toThrow(/playback/);
    await expect(store.updateSound(board.id, sound.id, { ...settings, shortcut: { code: 'ControlLeft', ctrl: true, alt: false, shift: false, meta: false } })).rejects.toThrow(/playback/);
    await expect(store.updateSound(board.id, sound.id, { ...settings, extra: true } as never)).rejects.toThrow(/playback/);
    await expect(store.updateSound('26a00123-1234-4234-8234-123456789099', sound.id, settings)).rejects.toThrow(/Board was not found/);
    await expect(store.updateSound(board.id, '26a00123-1234-4234-8234-123456789098', settings)).rejects.toThrow(/Sound was not found/);
    const persisted = JSON.parse(await readFile(path.join(root, 'library.json'), 'utf8'));
    persisted.boards[0].sounds[0].playback.extra = true;
    await writeFile(path.join(root, 'library.json'), JSON.stringify(persisted));
    await expect(new LibraryStore(root).load()).rejects.toThrow(/playback/);
  });

  it('rejects duplicate shortcuts per board, permits another board, and clears settings', async () => {
    const { root, store } = await setup();
    const boardA = (await store.createBoard('A')).boards[0];
    const boardB = (await store.createBoard('B')).boards[1];
    const source = path.join(root, 'door.wav');
    await writeFile(source, 'audio');
    const soundsA = (await store.importSounds(boardA.id, [source, source])).boards[0].sounds;
    const soundB = (await store.importSounds(boardB.id, [source])).boards[1].sounds[0];
    const shortcut = { code: 'KeyA', ctrl: true, alt: false, shift: false, meta: false };
    const assigned = { startTime: 1.25, endTime: 2.5, loop: true, shortcut };
    await store.updateSound(boardA.id, soundsA[0].id, assigned);
    await expect(store.updateSound(boardA.id, soundsA[1].id, assigned)).rejects.toThrow(/already assigned/);
    const otherBoardResult = await store.updateSound(boardB.id, soundB.id, assigned);
    expect(otherBoardResult.boards[1].sounds[0].playback).toEqual(assigned);
    const cleared = await store.updateSound(boardA.id, soundsA[0].id, { ...assigned, shortcut: null });
    expect(cleared.boards[0].sounds[0].playback?.shortcut).toBeNull();
    expect((await new LibraryStore(root).load()).boards[0].sounds[0].playback?.shortcut).toBeNull();
  });

  it('recovers after an atomic manifest replacement fails because the target is locked', async () => {
    const { root, store } = await setup();
    await store.load();
    const manifest = path.join(root, 'library.json');
    const backup = path.join(root, 'library.saved');
    await rename(manifest, backup);
    await mkdir(manifest);
    await expect(store.createBoard('Effects')).rejects.toThrow();
    await rm(manifest, { recursive: true });
    await rename(backup, manifest);
    expect((await store.createBoard('Effects')).boards.map((board) => board.name)).toEqual(['Effects']);
  });

  it('returns committed removal state even when managed-file cleanup fails', async () => {
    const { root } = await setup();
    const store = new LibraryStore(root, async () => { throw new Error('file locked'); });
    const board = (await store.createBoard('Effects')).boards[0];
    const source = path.join(root, 'door.wav');
    await writeFile(source, 'audio');
    const sound = (await store.importSounds(board.id, [source])).boards[0].sounds[0];
    const result = await store.removeSound(board.id, sound.id);
    expect(result.boards[0].sounds).toEqual([]);
    expect((await store.load()).boards[0].sounds).toEqual([]);
    expect((await lstat(path.join(root, 'audio', sound.fileName))).isFile()).toBe(true);
  });
});
